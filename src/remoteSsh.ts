import * as vscode from 'vscode';

export class RemoteSshBridge {
	private static instance: RemoteSshBridge;

	private constructor() {}

	public static getInstance(): RemoteSshBridge {
		if (!RemoteSshBridge.instance) {
			RemoteSshBridge.instance = new RemoteSshBridge();
		}
		return RemoteSshBridge.instance;
	}

	/**
	 * Connect to a host via Remote-SSH extension
	 */
	async connectToHost(hostName: string, workspacePath?: string): Promise<void> {
		// Ensure Remote-SSH is available
		// In Cursor, Remote-SSH is built-in, so this should always pass
		const isAvailable = await this.checkRemoteSshAvailable();
		if (!isAvailable) {
			throw new Error(
				'Remote-SSH is not available. ' +
				'In Cursor, Remote-SSH is built-in. ' +
				'In VS Code, please install the Remote-SSH extension from the marketplace.'
			);
		}

		// First, reload SSH configs to ensure our new host is recognized
		try {
			await vscode.commands.executeCommand('remote-ssh.reload');
			// Wait longer for the reload to complete and host to be recognized
			await new Promise(resolve => setTimeout(resolve, 2000));
		} catch {
			// Ignore if reload command doesn't exist
		}

		// Try to refresh the Remote Explorer to ensure the host appears
		try {
			await vscode.commands.executeCommand('remoteExplorer.refresh');
			await new Promise(resolve => setTimeout(resolve, 1000));
		} catch {
			// Ignore if command doesn't exist
		}

		// Try Remote-SSH specific commands first (these should actually establish the connection)
		// Try Cursor/Anysphere specific commands first, then fall back to standard ones
		const commands: Array<{ cmd: string; arg: string | undefined }> = [
			// Cursor/Anysphere specific commands (try first)
			{ cmd: 'opensshremotes.openEmptyWindowOnHost', arg: hostName },
			{ cmd: 'anysphere.remote.ssh.connectToHost', arg: hostName },
			// Standard Remote-SSH commands
			{ cmd: 'remote.SSH.connectToHost', arg: hostName },
			{ cmd: 'remote-ssh.connectToHost', arg: hostName },
			{ cmd: 'remote-ssh.connectToNewWindow', arg: hostName },
			{ cmd: 'remoteExplorer.connectToHost', arg: hostName },
		];

		let lastError: any = null;
		
		for (const command of commands) {
			try {
				// Try executing the command
				const result = await vscode.commands.executeCommand(command.cmd, command.arg);
				// If command executed without throwing, consider it successful
				// Some commands might return undefined but still work
				console.log(`Successfully executed command: ${command.cmd} with result:`, result);
				return;
			} catch (error: any) {
				console.log(`Command ${command.cmd} failed:`, error.message);
				// Check if it's a "command not found" error
				if (error.message && error.message.includes('not found')) {
					lastError = error;
					continue; // Try next command
				}
				// For other errors, also continue to try next command
				lastError = error;
				continue;
			}
		}

		// Use the exact same approach as the working extension
		// URI format: vscode-remote://ssh-remote+${repoName}/workspaces/${simpleRepoName}
		try {
			const uriPath = workspacePath ? `/workspaces/${workspacePath}` : '';
			const remoteUri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostName}${uriPath}`);
			
			// Use the same options as the working extension: { forceNewWindow: true }
			await vscode.commands.executeCommand('vscode.openFolder', remoteUri, { forceNewWindow: true });
			console.log(`Opened folder with remote URI: ${remoteUri.toString()}`);
			
			// Connection should establish automatically
			return;
		} catch (error: any) {
			console.log('vscode.openFolder failed:', error.message);
			lastError = error;
		}

		// If all methods failed, provide helpful instructions
		// The host is in SSH config, user just needs to click in explorer
		const action = await vscode.window.showWarningMessage(
			`The host "${hostName}" has been added to your SSH config. ` +
			`Please click on it in the Remote-SSH explorer to connect, or use the Command Palette.`,
			'Open Remote Explorer',
			'Open Command Palette'
		);
		
		if (action === 'Open Remote Explorer') {
			try {
				await vscode.commands.executeCommand('remoteExplorer.view');
			} catch {
				// Ignore if command doesn't exist
			}
		} else if (action === 'Open Command Palette') {
			try {
				await vscode.commands.executeCommand('workbench.action.showCommands');
				await vscode.window.showInformationMessage(
					`Type "Remote-SSH: Connect to Host..." and select "${hostName}"`
				);
			} catch {
				// Ignore if command doesn't exist
			}
		}
		
		throw new Error(
			`Could not automatically connect. ` +
			`The host "${hostName}" is ready in your SSH config - please connect manually using the Remote-SSH explorer.`
		);
	}

	/**
	 * Check if Remote-SSH is available
	 * In Cursor, Remote-SSH is built-in (Anysphere Remote SSH)
	 * In VS Code, it's an extension
	 */
	async checkRemoteSshAvailable(): Promise<boolean> {
		// Check if we're in Cursor (has built-in Remote SSH) or VS Code (needs extension)
		const extensions = vscode.extensions.all;
		
		// Check for Cursor's built-in Remote SSH (Anysphere Remote SSH)
		const cursorRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id.includes('anysphere') && ext.id.includes('remote')
		);
		
		// Check for VS Code Remote-SSH extension (for VS Code compatibility)
		const vscodeRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id === 'ms-vscode-remote.remote-ssh' ||
				(ext.id.includes('remote-ssh') && !ext.id.includes('anysphere'))
		);
		
		// If either is available, Remote-SSH is available
		const remoteSshExt = cursorRemoteSsh || vscodeRemoteSsh;
		
		if (!remoteSshExt) {
			return false;
		}
		
		// Try to activate the extension if it's not already active
		if (!remoteSshExt.isActive) {
			try {
				await remoteSshExt.activate();
			} catch {
				// Extension might not be ready yet, but that's okay - built-in features might not need activation
				// Return true anyway since the feature exists
				return true;
			}
		}
		
		return true;
	}
}

