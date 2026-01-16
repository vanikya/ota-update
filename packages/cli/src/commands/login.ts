import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig, loadConfig } from '../config.js';
import { createOrganization, listApps } from '../utils/api.js';

export function createLoginCommand(): Command {
  const command = new Command('login')
    .description('Authenticate with the OTA Update server')
    .option('--api-key <key>', 'API key to use')
    .option('--server <url>', 'Server URL')
    .action(async (options) => {
      try {
        if (options.apiKey) {
          // Direct API key login
          saveConfig({
            apiKey: options.apiKey,
            ...(options.server && { serverUrl: options.server }),
          });

          // Verify the key works
          const spinner = ora('Verifying API key...').start();
          try {
            await listApps();
            spinner.succeed('Logged in successfully!');
          } catch (error) {
            spinner.fail('Invalid API key');
            process.exit(1);
          }
        } else {
          // Interactive login
          const config = loadConfig();

          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'serverUrl',
              message: 'Server URL:',
              default: options.server || config.serverUrl,
            },
            {
              type: 'list',
              name: 'authMethod',
              message: 'How do you want to authenticate?',
              choices: [
                { name: 'I have an API key', value: 'existing' },
                { name: 'Create a new organization', value: 'new' },
              ],
            },
          ]);

          saveConfig({ serverUrl: answers.serverUrl });

          if (answers.authMethod === 'existing') {
            const { apiKey } = await inquirer.prompt([
              {
                type: 'password',
                name: 'apiKey',
                message: 'Enter your API key:',
                mask: '*',
              },
            ]);

            saveConfig({ apiKey });

            const spinner = ora('Verifying API key...').start();
            try {
              const { apps } = await listApps();
              spinner.succeed(`Logged in successfully! You have ${apps.length} app(s).`);
            } catch (error) {
              spinner.fail('Invalid API key');
              saveConfig({ apiKey: undefined });
              process.exit(1);
            }
          } else {
            const { orgName } = await inquirer.prompt([
              {
                type: 'input',
                name: 'orgName',
                message: 'Organization name:',
                validate: (input: string) => input.length > 0 || 'Organization name is required',
              },
            ]);

            const spinner = ora('Creating organization...').start();

            try {
              const result = await createOrganization(orgName);
              spinner.succeed('Organization created!');

              saveConfig({ apiKey: result.apiKey });

              console.log('');
              console.log(chalk.yellow('⚠️  Important: Save your API key securely!'));
              console.log(chalk.cyan('API Key:'), result.apiKey);
              console.log(chalk.gray('This key will not be shown again.'));
              console.log('');
              console.log(chalk.green('You are now logged in. Run `ota apps create` to create your first app.'));
            } catch (error: any) {
              spinner.fail(`Failed to create organization: ${error.message}`);
              process.exit(1);
            }
          }
        }
      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

export function createLogoutCommand(): Command {
  const command = new Command('logout')
    .description('Log out from the OTA Update server')
    .action(() => {
      saveConfig({ apiKey: undefined });
      console.log(chalk.green('Logged out successfully.'));
    });

  return command;
}

export function createWhoamiCommand(): Command {
  const command = new Command('whoami')
    .description('Show current authentication status')
    .action(async () => {
      const config = loadConfig();

      if (!config.apiKey) {
        console.log(chalk.yellow('Not logged in. Run `ota login` to authenticate.'));
        return;
      }

      const spinner = ora('Checking authentication...').start();

      try {
        const { apps } = await listApps();
        spinner.stop();

        console.log(chalk.green('✓ Authenticated'));
        console.log(chalk.gray('Server:'), config.serverUrl);
        console.log(chalk.gray('Apps:'), apps.length);

        if (apps.length > 0) {
          console.log('');
          console.log('Your apps:');
          apps.forEach(app => {
            console.log(`  • ${app.name} (${chalk.cyan(app.slug)}) - ${app.platform}`);
          });
        }
      } catch (error: any) {
        spinner.fail('Authentication failed');
        console.log(chalk.yellow('Your API key may be invalid. Run `ota login` to re-authenticate.'));
      }
    });

  return command;
}
