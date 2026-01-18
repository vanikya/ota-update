import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { listApps, listReleases, createRelease, updateRollout, rollbackRelease } from '../utils/api.js';
import { loadProjectConfig } from '../config.js';
import { createBundle, detectProjectType, getBundleInfo } from '../utils/bundle.js';
import { signBundleForApp, loadSigningKeys } from '../utils/signing.js';

export function createReleaseCommand(): Command {
  const command = new Command('release')
    .description('Create and publish a new release')
    .option('--app <slug>', 'App slug')
    .option('--channel <name>', 'Channel name (default: production)')
    .option('-v, --release-version <version>', 'Version string (e.g., 1.0.0)')
    .option('--platform <platform>', 'Platform (ios, android)')
    .option('--bundle <path>', 'Path to pre-built bundle (skip building)')
    .option('--sourcemap <path>', 'Path to sourcemap file')
    .option('--min-app-version <version>', 'Minimum native app version')
    .option('--max-app-version <version>', 'Maximum native app version')
    .option('--mandatory', 'Mark this update as mandatory')
    .option('--notes <notes>', 'Release notes')
    .option('--rollout <percentage>', 'Initial rollout percentage (default: 100)')
    .option('--no-sign', 'Skip code signing')
    .option('--dev', 'Create development bundle')
    .action(async (options) => {
      try {
        const projectConfig = loadProjectConfig();

        // Resolve app
        let appSlug = options.app || projectConfig?.appSlug;
        if (!appSlug) {
          const { apps } = await listApps();
          if (apps.length === 0) {
            console.log(chalk.yellow('No apps found. Create one first with `ota apps create`.'));
            process.exit(1);
          }

          const { selectedApp } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedApp',
              message: 'Select app:',
              choices: apps.map(a => ({ name: `${a.name} (${a.slug})`, value: a.slug })),
            },
          ]);
          appSlug = selectedApp;
        }

        // Resolve channel
        const channel = options.channel || projectConfig?.channel || 'production';

        // Resolve version
        let version = options.releaseVersion;
        if (!version) {
          // Try to get from package.json
          if (fs.existsSync('package.json')) {
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
            version = pkg.version;
          }

          const { inputVersion } = await inquirer.prompt([
            {
              type: 'input',
              name: 'inputVersion',
              message: 'Version:',
              default: version,
              validate: (input: string) => {
                if (!/^\d+\.\d+\.\d+/.test(input)) {
                  return 'Version must be in semver format (e.g., 1.0.0)';
                }
                return true;
              },
            },
          ]);
          version = inputVersion;
        }

        // Resolve platform
        let platform = options.platform || projectConfig?.platform;
        if (!platform || platform === 'both') {
          const { selectedPlatform } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedPlatform',
              message: 'Platform:',
              choices: [
                { name: 'iOS', value: 'ios' },
                { name: 'Android', value: 'android' },
              ],
            },
          ]);
          platform = selectedPlatform;
        }

        // Get app ID
        const { apps } = await listApps();
        const app = apps.find(a => a.slug === appSlug);
        if (!app) {
          console.log(chalk.red(`App "${appSlug}" not found.`));
          process.exit(1);
        }

        let bundlePath = options.bundle;
        let sourcemapPath = options.sourcemap;

        // Build bundle if not provided
        if (!bundlePath) {
          const projectType = detectProjectType();
          if (!projectType) {
            console.log(chalk.red('Not a React Native or Expo project. Use --bundle to provide a pre-built bundle.'));
            process.exit(1);
          }

          console.log(chalk.cyan(`Building ${platform} bundle...`));
          console.log('');

          const buildSpinner = ora('Creating bundle with Metro...').start();

          try {
            const result = await createBundle({
              platform,
              dev: options.dev || false,
            });

            bundlePath = result.bundlePath;
            sourcemapPath = result.sourcemapPath;

            buildSpinner.succeed(`Bundle created (${formatSize(result.bundleSize)})`);
          } catch (error: any) {
            buildSpinner.fail('Bundle creation failed');
            console.error(error.message);
            process.exit(1);
          }
        }

        // Sign bundle if signing is enabled
        let signature: string | undefined;
        if (options.sign !== false) {
          const keys = loadSigningKeys(appSlug);
          if (keys) {
            const signSpinner = ora('Signing bundle...').start();
            signature = signBundleForApp(appSlug, bundlePath);
            signSpinner.succeed('Bundle signed');
          } else {
            console.log(chalk.yellow('No signing keys found. Use `ota keys generate` to set up code signing.'));
          }
        }

        // Upload release
        const uploadSpinner = ora('Uploading release...').start();

        try {
          const { release } = await createRelease(
            app.id,
            bundlePath,
            {
              version,
              channelName: channel,
              minAppVersion: options.minAppVersion,
              maxAppVersion: options.maxAppVersion,
              isMandatory: options.mandatory || false,
              releaseNotes: options.notes,
              signature,
            },
            sourcemapPath
          );

          uploadSpinner.succeed(`Release ${chalk.cyan(release.version)} published to ${chalk.green(channel)}`);

          // Update rollout if specified
          if (options.rollout && options.rollout !== '100') {
            const rolloutSpinner = ora(`Setting rollout to ${options.rollout}%...`).start();
            await updateRollout(app.id, release.id, parseInt(options.rollout, 10));
            rolloutSpinner.succeed(`Rollout set to ${options.rollout}%`);
          }

          console.log('');
          console.log(chalk.green('✓ Release successful!'));
          console.log('');
          console.log(`  Version: ${version}`);
          console.log(`  Channel: ${channel}`);
          console.log(`  Platform: ${platform}`);
          if (options.mandatory) {
            console.log(`  Mandatory: ${chalk.yellow('Yes')}`);
          }
        } catch (error: any) {
          uploadSpinner.fail('Upload failed');
          console.error(chalk.red(error.message));
          process.exit(1);
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

export function createRollbackCommand(): Command {
  const command = new Command('rollback')
    .description('Rollback to a previous release')
    .option('--app <slug>', 'App slug')
    .option('--channel <name>', 'Channel name')
    .option('--release <id>', 'Release ID to rollback to')
    .action(async (options) => {
      try {
        const projectConfig = loadProjectConfig();
        const appSlug = options.app || projectConfig?.appSlug;

        if (!appSlug) {
          console.log(chalk.red('App slug is required. Use --app or create ota-update.json'));
          process.exit(1);
        }

        // Get app ID
        const { apps } = await listApps();
        const app = apps.find(a => a.slug === appSlug);
        if (!app) {
          console.log(chalk.red(`App "${appSlug}" not found.`));
          process.exit(1);
        }

        const channel = options.channel || projectConfig?.channel || 'production';

        // Get releases
        const { releases } = await listReleases(app.id, channel);

        if (releases.length < 2) {
          console.log(chalk.yellow('Not enough releases to rollback.'));
          process.exit(1);
        }

        let releaseId = options.release;

        if (!releaseId) {
          // Show releases and let user pick
          const { selectedRelease } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedRelease',
              message: 'Select release to rollback to:',
              choices: releases.slice(1).map(r => ({
                name: `${r.version} (${new Date(r.created_at * 1000).toLocaleDateString()})`,
                value: r.id,
              })),
            },
          ]);
          releaseId = selectedRelease;
        }

        const spinner = ora('Rolling back...').start();

        await rollbackRelease(app.id, releaseId);

        const targetRelease = releases.find(r => r.id === releaseId);
        spinner.succeed(`Rolled back to version ${chalk.cyan(targetRelease?.version || releaseId)}`);
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

export function createReleasesListCommand(): Command {
  const command = new Command('releases')
    .description('List releases')
    .option('--app <slug>', 'App slug')
    .option('--channel <name>', 'Filter by channel')
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

        const spinner = ora('Fetching releases...').start();

        const { releases } = await listReleases(app.id, options.channel);

        spinner.stop();

        if (releases.length === 0) {
          console.log(chalk.yellow('No releases found.'));
          return;
        }

        console.log(chalk.bold(`\nReleases for ${appSlug}:\n`));

        releases.forEach(r => {
          const status = r.rollout_active
            ? chalk.green(`${r.rollout_percentage}% rollout`)
            : chalk.gray('inactive');

          console.log(`  ${chalk.cyan(r.version)} - ${r.channel_name}`);
          console.log(`    ${status} | ${formatSize(r.bundle_size)} | ${new Date(r.created_at * 1000).toLocaleString()}`);
          if (r.is_mandatory) {
            console.log(`    ${chalk.yellow('Mandatory')}`);
          }
          console.log('');
        });
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
