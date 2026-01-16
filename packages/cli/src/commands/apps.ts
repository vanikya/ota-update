import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { listApps, createApp, getApp, deleteApp } from '../utils/api.js';
import { saveProjectConfig } from '../config.js';
import { setupSigningForApp, exportPublicKey } from '../utils/signing.js';

export function createAppsCommand(): Command {
  const command = new Command('apps')
    .description('Manage apps');

  // List apps
  command
    .command('list')
    .alias('ls')
    .description('List all apps')
    .action(async () => {
      const spinner = ora('Fetching apps...').start();

      try {
        const { apps } = await listApps();
        spinner.stop();

        if (apps.length === 0) {
          console.log(chalk.yellow('No apps found. Run `ota apps create` to create one.'));
          return;
        }

        console.log(chalk.bold('Your Apps:\n'));
        apps.forEach(app => {
          console.log(`  ${chalk.cyan(app.slug)}`);
          console.log(`    Name: ${app.name}`);
          console.log(`    Platform: ${app.platform}`);
          console.log(`    ID: ${chalk.gray(app.id)}`);
          console.log('');
        });
      } catch (error: any) {
        spinner.fail(`Failed to list apps: ${error.message}`);
        process.exit(1);
      }
    });

  // Create app
  command
    .command('create')
    .description('Create a new app')
    .option('--name <name>', 'App name')
    .option('--slug <slug>', 'App slug (unique identifier)')
    .option('--platform <platform>', 'Platform (ios, android, both)')
    .option('--no-signing', 'Skip setting up code signing')
    .option('--init', 'Create ota-update.json in current directory')
    .action(async (options) => {
      try {
        let name = options.name;
        let slug = options.slug;
        let platform = options.platform;

        if (!name || !slug || !platform) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'name',
              message: 'App name:',
              default: name,
              when: !name,
              validate: (input: string) => input.length > 0 || 'Name is required',
            },
            {
              type: 'input',
              name: 'slug',
              message: 'App slug (lowercase, hyphens allowed):',
              default: slug,
              when: !slug,
              validate: (input: string) => {
                if (!/^[a-z0-9-]+$/.test(input)) {
                  return 'Slug must contain only lowercase letters, numbers, and hyphens';
                }
                return true;
              },
            },
            {
              type: 'list',
              name: 'platform',
              message: 'Platform:',
              default: platform,
              when: !platform,
              choices: [
                { name: 'Both iOS and Android', value: 'both' },
                { name: 'iOS only', value: 'ios' },
                { name: 'Android only', value: 'android' },
              ],
            },
          ]);

          name = name || answers.name;
          slug = slug || answers.slug;
          platform = platform || answers.platform;
        }

        let signingPublicKey: string | undefined;

        if (options.signing !== false) {
          const signingSpinner = ora('Setting up code signing...').start();
          const keys = setupSigningForApp(slug);
          signingPublicKey = keys.publicKey;
          signingSpinner.succeed('Code signing keys generated');
        }

        const spinner = ora('Creating app...').start();

        const { app } = await createApp({
          name,
          slug,
          platform,
          signingPublicKey,
        });

        spinner.succeed(`App created: ${chalk.cyan(app.slug)}`);

        if (options.init) {
          saveProjectConfig({
            appSlug: slug,
            channel: 'production',
            platform,
          });
          console.log(chalk.gray('Created ota-update.json'));
        }

        console.log('');
        console.log('Next steps:');
        console.log(`  1. Run ${chalk.cyan('ota release')} to publish your first update`);
        console.log(`  2. Integrate the SDK in your app`);

        if (signingPublicKey) {
          console.log('');
          console.log(chalk.gray('Signing keys saved to ~/.ota-update/keys/'));
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Get app details
  command
    .command('info <appId>')
    .description('Get app details')
    .action(async (appId) => {
      const spinner = ora('Fetching app details...').start();

      try {
        const { app, channels, releaseCount } = await getApp(appId);
        spinner.stop();

        console.log(chalk.bold(`\n${app.name}\n`));
        console.log(`  Slug: ${chalk.cyan(app.slug)}`);
        console.log(`  Platform: ${app.platform}`);
        console.log(`  ID: ${chalk.gray(app.id)}`);
        console.log(`  Code Signing: ${app.signing_public_key ? chalk.green('Enabled') : chalk.yellow('Disabled')}`);
        console.log(`  Total Releases: ${releaseCount}`);
        console.log('');
        console.log(chalk.bold('Channels:'));
        channels.forEach(ch => {
          console.log(`  • ${ch.name}`);
        });
      } catch (error: any) {
        spinner.fail(`Failed to get app: ${error.message}`);
        process.exit(1);
      }
    });

  // Delete app
  command
    .command('delete <appId>')
    .description('Delete an app')
    .option('--force', 'Skip confirmation')
    .action(async (appId, options) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to delete app "${appId}"? This cannot be undone.`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log('Aborted.');
            return;
          }
        }

        const spinner = ora('Deleting app...').start();

        await deleteApp(appId);
        spinner.succeed('App deleted');
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}
