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
		const isAvailable = await this.checkRemoteSshAvailable();
		if (!isAvailable) {
			// Provide helpful error message with installation option
			const action = await vscode.window.showErrorMessage(
				'Remote-SSH extension is required to connect to Codespaces. Would you like to install it?',
				'Install Remote-SSH',
				'Cancel'
			);

			if (action === 'Install Remote-SSH') {
				// Open the Remote-SSH extension in the marketplace
				const remoteSshUri = vscode.Uri.parse('vscode:extension/ms-vscode-remote.remote-ssh');
				await vscode.commands.executeCommand('vscode.open', remoteSshUri);
				throw new Error('Please install the Remote-SSH extension and try again.');
			}

			throw new Error(
				'Remote-SSH extension is required. ' +
				'Please install "Remote - SSH" (ms-vscode-remote.remote-ssh) from the marketplace.'
			);
		}

		// First, reload SSH configs to ensure our new host is recognized
		try {
			await vscode.commands.executeCommand('remote-ssh.reload');
			// Wait for the reload to complete and host to be recognized
			await new Promise(resolve => setTimeout(resolve, 1000));
		} catch {
			// Ignore if reload command doesn't exist
		}

		// Try to refresh the Remote Explorer to ensure the host appears
		try {
			await vscode.commands.executeCommand('remoteExplorer.refresh');
			// Brief wait for refresh to complete
			await new Promise(resolve => setTimeout(resolve, 500));
		} catch {
			// Ignore if command doesn't exist
		}

		// Use the exact same approach as the working extension
		// Skip trying commands that don't exist in Cursor - go directly to vscode.openFolder
		// URI format: vscode-remote://ssh-remote+${repoName}/workspaces/${simpleRepoName}
		const uriPath = workspacePath ? `/workspaces/${workspacePath}` : '';
		const remoteUri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostName}${uriPath}`);
		
		// Open in the same window (user can use Remote-SSH explorer to open in new window if preferred)
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
		
		// Connection should establish automatically
		return;
	}

	/**
	 * Check if Remote-SSH is available
	 * Checks for both Cursor's built-in Remote SSH and VS Code's Remote-SSH extension
	 */
	async checkRemoteSshAvailable(): Promise<boolean> {
		const extensions = vscode.extensions.all;
		
		// First, check for the standard VS Code Remote-SSH extension (most common)
		const vscodeRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id === 'ms-vscode-remote.remote-ssh'
		);
		
		// Check for Cursor's built-in Remote SSH (Anysphere Remote SSH)
		const cursorRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id.includes('anysphere') && 
				(ext.id.includes('remote') || ext.id.includes('ssh'))
		);
		
		// Check for any other Remote-SSH extension variants
		const otherRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id.includes('remote-ssh') && 
				!ext.id.includes('anysphere') &&
				ext.id !== 'ms-vscode-remote.remote-ssh'
		);
		
		// If any Remote-SSH extension is found, it's available
		const remoteSshExt = vscodeRemoteSsh || cursorRemoteSsh || otherRemoteSsh;
		
		if (!remoteSshExt) {
			return false;
		}
		
		// Try to activate the extension if it's not already active
		if (!remoteSshExt.isActive) {
			try {
				await remoteSshExt.activate();
			} catch {
				// Extension might not be ready yet, but that's okay
				// Return true anyway since the extension exists
				return true;
			}
		}
		
		return true;
	}
}

