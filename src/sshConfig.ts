import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_MARKER_START = '# >>> Cursor Codespaces Extension (managed)';
const CONFIG_MARKER_END = '# <<< Cursor Codespaces Extension';

export class SshConfigManager {
	private static instance: SshConfigManager;
	private sshConfigPath: string;

	private constructor() {
		this.sshConfigPath = this.getSshConfigPath();
	}

	/**
	 * Get the SSH config file path, checking for custom location in VS Code settings
	 * Follows VS Code settings precedence: workspace settings > user settings > default
	 * This matches how Remote-SSH extension reads the configFile setting
	 */
	private getSshConfigPath(): string {
		// Check for custom SSH config file location from Remote-SSH extension setting
		// getConfiguration() automatically checks workspace settings first, then user settings
		const customConfigFile = vscode.workspace.getConfiguration('remote.SSH').get<string>('configFile');
		
		if (customConfigFile && customConfigFile.trim()) {
			let configPath = customConfigFile.trim();
			
			// Expand ~ to home directory if present (works on all platforms)
			if (configPath.startsWith('~')) {
				configPath = configPath.replace(/^~/, os.homedir());
			}
			
			// Resolve to absolute path
			// If it's already absolute, path.resolve will return it as-is
			// If it's relative, resolve it relative to the current working directory
			// (which is typically the workspace root or extension directory)
			return path.resolve(configPath);
		}
		
		// Default to standard location
		const homeDir = os.homedir();
		return path.join(homeDir, '.ssh', 'config');
	}

	public static getInstance(): SshConfigManager {
		if (!SshConfigManager.instance) {
			SshConfigManager.instance = new SshConfigManager();
		}
		return SshConfigManager.instance;
	}

	/**
	 * Ensure SSH directory and config file have correct permissions (Linux/Unix requirement)
	 */
	private ensureCorrectPermissions(): void {
		const sshDir = path.dirname(this.sshConfigPath);
		
		// Ensure .ssh directory exists with correct permissions (0o700)
		if (!fs.existsSync(sshDir)) {
			fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
		} else {
			// Fix permissions if directory exists but has wrong permissions
			try {
				fs.chmodSync(sshDir, 0o700);
			} catch (error: any) {
				// If we can't change permissions, log but don't fail
				// The directory might be owned by root or have other restrictions
				console.warn(`Could not set permissions on ${sshDir}: ${error.message}`);
			}
		}
		
		// Ensure config file has correct permissions (0o600) if it exists
		if (fs.existsSync(this.sshConfigPath)) {
			try {
				fs.chmodSync(this.sshConfigPath, 0o600);
			} catch (error: any) {
				// If we can't change permissions, log but don't fail
				console.warn(`Could not set permissions on ${this.sshConfigPath}: ${error.message}`);
			}
		}
	}

	/**
	 * Read the SSH config file
	 */
	async readConfig(): Promise<string> {
		try {
			// Ensure correct permissions before reading
			this.ensureCorrectPermissions();
			
			if (!fs.existsSync(this.sshConfigPath)) {
				// Create empty config file with correct permissions
				fs.writeFileSync(this.sshConfigPath, '', { mode: 0o600 });
				return '';
			}
			return fs.readFileSync(this.sshConfigPath, 'utf-8');
		} catch (error: any) {
			// Provide more helpful error message for permission issues
			if (error.code === 'EACCES' || error.message.includes('permission denied')) {
				throw new Error(
					`Permission denied accessing SSH config file. ` +
					`Please ensure you have read/write permissions for ${this.sshConfigPath} ` +
					`and that the .ssh directory has permissions 700.`
				);
			}
			throw new Error(`Failed to read SSH config: ${error.message}`);
		}
	}

	/**
	 * Extract the managed section from config
	 */
	extractManagedSection(config: string): { before: string; managed: string; after: string } {
		const startIndex = config.indexOf(CONFIG_MARKER_START);
		const endIndex = config.indexOf(CONFIG_MARKER_END);

		if (startIndex === -1 || endIndex === -1) {
			// No managed section exists
			return {
				before: config,
				managed: '',
				after: ''
			};
		}

		const before = config.substring(0, startIndex).trimEnd();
		const managed = config.substring(startIndex, endIndex + CONFIG_MARKER_END.length);
		const after = config.substring(endIndex + CONFIG_MARKER_END.length).trimStart();

		return { before, managed, after };
	}

	/**
	 * Merge new SSH config into the file
	 */
	async mergeConfig(newConfig: string): Promise<void> {
		try {
			const currentConfig = await this.readConfig();
			const { before, after } = this.extractManagedSection(currentConfig);

			// Build new managed section
			const managedSection = [
				CONFIG_MARKER_START,
				newConfig.trim(),
				CONFIG_MARKER_END
			].join('\n');

			// Combine all parts
			const parts = [before, managedSection, after].filter(part => part.length > 0);
			const newContent = parts.join('\n\n') + '\n';

			// Ask for permission on first write
			const hasManagedSection = currentConfig.includes(CONFIG_MARKER_START);
			if (!hasManagedSection) {
				// Create a user-friendly display path
				let configFileDisplay = this.sshConfigPath;
				const homeDir = os.homedir();
				if (this.sshConfigPath.startsWith(homeDir)) {
					configFileDisplay = this.sshConfigPath.replace(homeDir, '~');
				}
				
				const action = await vscode.window.showInformationMessage(
					`This extension needs to modify your SSH config file (${configFileDisplay}) to add Codespace entries. Continue?`,
					'Allow',
					'Cancel'
				);

				if (action !== 'Allow') {
					throw new Error('User declined SSH config modification');
				}
			}

			// Ensure correct permissions before writing
			this.ensureCorrectPermissions();
			
			// Write the new config with correct permissions
			fs.writeFileSync(this.sshConfigPath, newContent, { mode: 0o600 });
		} catch (error: any) {
			// Provide more helpful error message for permission issues
			if (error.code === 'EACCES' || error.message.includes('permission denied')) {
				throw new Error(
					`Permission denied writing to SSH config file. ` +
					`Please ensure you have write permissions for ${this.sshConfigPath} ` +
					`and that the .ssh directory has permissions 700. ` +
					`You may need to run: chmod 700 ~/.ssh && chmod 600 ~/.ssh/config`
				);
			}
			throw new Error(`Failed to merge SSH config: ${error.message}`);
		}
	}

}

