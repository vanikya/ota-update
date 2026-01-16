#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createLoginCommand, createLogoutCommand, createWhoamiCommand } from './commands/login.js';
import { createAppsCommand } from './commands/apps.js';
import { createReleaseCommand, createRollbackCommand, createReleasesListCommand } from './commands/release.js';
import { createChannelsCommand } from './commands/channels.js';
import { loadConfig, getApiKey } from './config.js';

const program = new Command();

program
  .name('ota')
  .description('OTA Update CLI - Manage over-the-air updates for React Native apps')
  .version('0.1.0');

// Auth commands
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createWhoamiCommand());

// App management
program.addCommand(createAppsCommand());

// Channel management
program.addCommand(createChannelsCommand());

// Release management
program.addCommand(createReleaseCommand());
program.addCommand(createRollbackCommand());
program.addCommand(createReleasesListCommand());

// Analytics command
program
  .command('analytics')
  .description('View update analytics')
  .option('--app <slug>', 'App slug')
  .option('--days <number>', 'Number of days to look back', '7')
  .action(async (options) => {
    const { loadProjectConfig } = await import('./config.js');
    const { listApps, getAnalytics } = await import('./utils/api.js');
    const ora = (await import('ora')).default;

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

      const spinner = ora('Fetching analytics...').start();

      const analytics = await getAnalytics(app.id, parseInt(options.days, 10));

      spinner.stop();

      console.log(chalk.bold(`\nAnalytics for ${appSlug} (last ${options.days} days)\n`));

      console.log(chalk.cyan('Summary:'));
      console.log(`  Unique devices: ${analytics.summary.uniqueDevices}`);
      console.log(`  Success rate: ${analytics.summary.successRate ? `${analytics.summary.successRate}%` : 'N/A'}`);
      console.log('');

      console.log(chalk.cyan('Events:'));
      Object.entries(analytics.summary.eventCounts).forEach(([event, count]) => {
        console.log(`  ${event}: ${count}`);
      });
      console.log('');

      if (analytics.errorBreakdown.length > 0) {
        console.log(chalk.yellow('Top Errors:'));
        analytics.errorBreakdown.slice(0, 5).forEach(e => {
          console.log(`  ${e.count}x: ${e.error_message || 'Unknown error'}`);
        });
        console.log('');
      }

      if (analytics.appVersions.length > 0) {
        console.log(chalk.cyan('App Versions:'));
        analytics.appVersions.slice(0, 10).forEach(v => {
          console.log(`  ${v.app_version}: ${v.device_count} devices`);
        });
      }
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Keys management
program
  .command('keys')
  .description('Manage code signing keys')
  .addCommand(
    new Command('generate')
      .description('Generate signing keys for an app')
      .option('--app <slug>', 'App slug')
      .action(async (options) => {
        const { loadProjectConfig } = await import('./config.js');
        const { setupSigningForApp, loadSigningKeys, exportPublicKey } = await import('./utils/signing.js');
        const inquirer = (await import('inquirer')).default;

        try {
          const projectConfig = loadProjectConfig();
          let appSlug = options.app || projectConfig?.appSlug;

          if (!appSlug) {
            const { inputSlug } = await inquirer.prompt([
              {
                type: 'input',
                name: 'inputSlug',
                message: 'App slug:',
                validate: (input: string) => input.length > 0 || 'Required',
              },
            ]);
            appSlug = inputSlug;
          }

          const existing = loadSigningKeys(appSlug);
          if (existing) {
            const { overwrite } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'overwrite',
                message: 'Keys already exist for this app. Overwrite?',
                default: false,
              },
            ]);

            if (!overwrite) {
              console.log('Aborted.');
              return;
            }
          }

          const keys = setupSigningForApp(appSlug);

          console.log(chalk.green('✓ Signing keys generated'));
          console.log('');
          console.log(chalk.gray('Keys saved to: ~/.ota-update/keys/'));
          console.log('');
          console.log(chalk.cyan('Public key (for server):'));
          console.log(keys.publicKey);
          console.log('');
          console.log(chalk.yellow('Keep your private key secure!'));
        } catch (error: any) {
          console.error(chalk.red('Error:'), error.message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('export')
      .description('Export public key for an app')
      .option('--app <slug>', 'App slug')
      .action(async (options) => {
        const { loadProjectConfig } = await import('./config.js');
        const { exportPublicKey } = await import('./utils/signing.js');
        const inquirer = (await import('inquirer')).default;

        try {
          const projectConfig = loadProjectConfig();
          let appSlug = options.app || projectConfig?.appSlug;

          if (!appSlug) {
            const { inputSlug } = await inquirer.prompt([
              {
                type: 'input',
                name: 'inputSlug',
                message: 'App slug:',
              },
            ]);
            appSlug = inputSlug;
          }

          const publicKey = exportPublicKey(appSlug);

          console.log(chalk.cyan('Public Key:'));
          console.log(publicKey);
        } catch (error: any) {
          console.error(chalk.red('Error:'), error.message);
          process.exit(1);
        }
      })
  );

// Init command
program
  .command('init')
  .description('Initialize OTA Update in the current project')
  .action(async () => {
    const inquirer = (await import('inquirer')).default;
    const { saveProjectConfig, loadProjectConfig } = await import('./config.js');
    const { listApps } = await import('./utils/api.js');
    const { detectProjectType } = await import('./utils/bundle.js');
    const fs = await import('fs');

    const existing = loadProjectConfig();
    if (existing) {
      console.log(chalk.yellow('ota-update.json already exists.'));
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: 'Overwrite?',
          default: false,
        },
      ]);

      if (!overwrite) {
        return;
      }
    }

    const projectType = detectProjectType();
    if (!projectType) {
      console.log(chalk.yellow('Warning: Could not detect React Native or Expo project.'));
    }

    // Check if logged in
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow('Not logged in. Run `ota login` first to link to an existing app.'));
      const { appSlug } = await inquirer.prompt([
        {
          type: 'input',
          name: 'appSlug',
          message: 'App slug:',
          validate: (input: string) => input.length > 0 || 'Required',
        },
      ]);

      saveProjectConfig({
        appSlug,
        channel: 'production',
        platform: 'both',
      });

      console.log(chalk.green('✓ Created ota-update.json'));
      return;
    }

    const { apps } = await listApps();

    if (apps.length === 0) {
      console.log(chalk.yellow('No apps found. Create one first with `ota apps create`.'));
      return;
    }

    const { selectedApp, channel, platform } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedApp',
        message: 'Select app:',
        choices: apps.map(a => ({ name: `${a.name} (${a.slug})`, value: a.slug })),
      },
      {
        type: 'input',
        name: 'channel',
        message: 'Default channel:',
        default: 'production',
      },
      {
        type: 'list',
        name: 'platform',
        message: 'Platform:',
        choices: [
          { name: 'Both', value: 'both' },
          { name: 'iOS', value: 'ios' },
          { name: 'Android', value: 'android' },
        ],
      },
    ]);

    saveProjectConfig({
      appSlug: selectedApp,
      channel,
      platform,
    });

    console.log(chalk.green('✓ Created ota-update.json'));
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Install the SDK: ${chalk.cyan('npm install @ota-update/react-native')}`);
    console.log(`  2. Run ${chalk.cyan('ota release')} to publish an update`);
  });

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(`Run ${chalk.cyan('ota --help')} for available commands.`);
  process.exit(1);
});

// Check authentication for commands that need it
const authRequiredCommands = ['apps', 'channels', 'release', 'rollback', 'releases', 'analytics'];

program.hook('preAction', (thisCommand) => {
  const commandName = thisCommand.args[0];

  if (authRequiredCommands.includes(commandName)) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow('Not logged in. Run `ota login` first.'));
      process.exit(1);
    }
  }
});

program.parse();
