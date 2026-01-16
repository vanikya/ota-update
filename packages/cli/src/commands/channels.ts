import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { listApps, listChannels, createChannel, deleteChannel } from '../utils/api.js';
import { loadProjectConfig } from '../config.js';

export function createChannelsCommand(): Command {
  const command = new Command('channels')
    .description('Manage release channels');

  // List channels
  command
    .command('list')
    .alias('ls')
    .description('List all channels for an app')
    .option('--app <slug>', 'App slug')
    .action(async (options) => {
      try {
        const projectConfig = loadProjectConfig();
        const appSlug = options.app || projectConfig?.appSlug;

        if (!appSlug) {
          console.log(chalk.red('App slug is required. Use --app or create ota-update.json'));
          process.exit(1);
        }

        const { apps } = await listApps();
        const app = apps.find(a => a.slug === appSlug);
        if (!app) {
          console.log(chalk.red(`App "${appSlug}" not found.`));
          process.exit(1);
        }

        const spinner = ora('Fetching channels...').start();

        const { channels } = await listChannels(app.id);

        spinner.stop();

        if (channels.length === 0) {
          console.log(chalk.yellow('No channels found.'));
          return;
        }

        console.log(chalk.bold(`\nChannels for ${appSlug}:\n`));

        channels.forEach(ch => {
          const version = ch.latest_version
            ? chalk.cyan(ch.latest_version)
            : chalk.gray('no releases');

          console.log(`  ${chalk.green(ch.name)}`);
          console.log(`    Latest: ${version}`);
          console.log(`    Releases: ${ch.release_count}`);
          console.log('');
        });
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Create channel
  command
    .command('create <name>')
    .description('Create a new channel')
    .option('--app <slug>', 'App slug')
    .action(async (name, options) => {
      try {
        const projectConfig = loadProjectConfig();
        const appSlug = options.app || projectConfig?.appSlug;

        if (!appSlug) {
          console.log(chalk.red('App slug is required. Use --app or create ota-update.json'));
          process.exit(1);
        }

        const { apps } = await listApps();
        const app = apps.find(a => a.slug === appSlug);
        if (!app) {
          console.log(chalk.red(`App "${appSlug}" not found.`));
          process.exit(1);
        }

        const spinner = ora(`Creating channel "${name}"...`).start();

        const { channel } = await createChannel(app.id, name);

        spinner.succeed(`Channel "${chalk.green(channel.name)}" created`);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Delete channel
  command
    .command('delete <name>')
    .description('Delete a channel')
    .option('--app <slug>', 'App slug')
    .option('--force', 'Skip confirmation')
    .action(async (name, options) => {
      try {
        const projectConfig = loadProjectConfig();
        const appSlug = options.app || projectConfig?.appSlug;

        if (!appSlug) {
          console.log(chalk.red('App slug is required. Use --app or create ota-update.json'));
          process.exit(1);
        }

        const { apps } = await listApps();
        const app = apps.find(a => a.slug === appSlug);
        if (!app) {
          console.log(chalk.red(`App "${appSlug}" not found.`));
          process.exit(1);
        }

        // Get channel ID
        const { channels } = await listChannels(app.id);
        const channel = channels.find(c => c.name === name);

        if (!channel) {
          console.log(chalk.red(`Channel "${name}" not found.`));
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to delete channel "${name}"? This will delete all releases in this channel.`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log('Aborted.');
            return;
          }
        }

        const spinner = ora(`Deleting channel "${name}"...`).start();

        await deleteChannel(app.id, (channel as any).id);

        spinner.succeed(`Channel "${name}" deleted`);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}
