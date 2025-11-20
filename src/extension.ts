import * as vscode from 'vscode';
import { GhService } from './ghService';
import { SshConfigManager } from './sshConfig';
import { CodespacePicker } from './codespacePicker';
import { RemoteSshBridge } from './remoteSsh';
import { DevcontainerFixer } from './devcontainerFixer';

export function activate(context: vscode.ExtensionContext) {
	console.log('Cursor Codespaces extension is now active!');

	// Main connect command
	const connectCommand = vscode.commands.registerCommand(
		'cursorCodespaces.connect',
		async () => {
			await connectToCodespace();
		}
	);

	context.subscriptions.push(connectCommand);

	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	statusBarItem.command = 'cursorCodespaces.connect';
	statusBarItem.text = '$(remote) Connect to Codespace';
	statusBarItem.tooltip = 'Connect to a GitHub Codespace';
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);
}

async function connectToCodespace(): Promise<void> {
	const ghService = GhService.getInstance();
	const sshConfigManager = SshConfigManager.getInstance();
	const codespacePicker = CodespacePicker.getInstance();
	const remoteSshBridge = RemoteSshBridge.getInstance();
	const devcontainerFixer = DevcontainerFixer.getInstance();

	try {
		// Step 1: Ensure GitHub CLI is ready
		const isReady = await ghService.ensureReady();
		if (!isReady) {
			return;
		}

		// Step 2: Check if Remote-SSH is available
		// In Cursor, Remote-SSH is built-in, so this should always pass
		const remoteSshAvailable = await remoteSshBridge.checkRemoteSshAvailable();
		if (!remoteSshAvailable) {
			await vscode.window.showErrorMessage(
				'Remote-SSH is not available. ' +
				'In Cursor, Remote-SSH is built-in. ' +
				'If you are using VS Code, please install the Remote-SSH extension from the marketplace.'
			);
			return;
		}

		// Step 3: Pick a codespace
		const codespace = await codespacePicker.pickCodespace();
		if (!codespace) {
			return;
		}

		// Step 4: Ensure codespace is available (wait if it's starting)
		// Note: Codespaces may start automatically when accessed via SSH
		if (codespace.state !== 'Available') {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Waiting for codespace to be available...',
					cancellable: false
				},
				async () => {
					await ghService.ensureCodespaceAvailable(codespace.name);
				}
			);
		}

		// Step 5: Generate SSH config
		let sshConfig: string;
		try {
			sshConfig = await ghService.generateSshConfig(codespace.name);
		} catch (error: any) {
			if (error.message === 'SSHD_NOT_CONFIGURED') {
				await devcontainerFixer.offerSshdFix();
				return;
			}
			throw error;
		}

		// Step 6: Prepare repository-based host name
		// Repository format: "owner/repo-name" (e.g., "trufla-technology/trumarket-api")
		const repoName = codespace.repository.replace('/', '-'); // For SSH Host: "owner-repo-name"
		// For workspace path, we need just the repo name (the part after the slash)
		const simpleRepoName = codespace.repository.split('/')[1]; // Just "repo-name" (e.g., "trumarket-api")
		
		console.log(`Repository: ${codespace.repository}, repoName: ${repoName}, simpleRepoName: ${simpleRepoName}`);
		
		// Modify SSH config to use repository name as Host (like the working extension)
		const modifiedSshConfig = sshConfig.replace(/^(Host\s+).*/m, `$1${repoName}`);

		// Step 7: Merge SSH config
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Updating SSH configuration...',
				cancellable: false
			},
			async () => {
				await sshConfigManager.mergeConfig(modifiedSshConfig);
			}
		);

		// Step 8: Connect via Remote-SSH using the same approach as the working extension
		// Add a small delay to ensure SSH config is recognized
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Use the same URI format as the working extension: vscode-remote://ssh-remote+${repoName}/workspaces/${simpleRepoName}
		await remoteSshBridge.connectToHost(repoName, simpleRepoName);
	} catch (error: any) {
		await vscode.window.showErrorMessage(
			`Failed to connect to codespace: ${error.message}`
		);
	}
}

export function deactivate() {}
