import * as vscode from 'vscode';
import { Codespace, GhService } from './ghService';
import { RemoteSshBridge } from './remoteSsh';

export class CodespaceTreeItem extends vscode.TreeItem {
	constructor(
		public readonly codespace: Codespace,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly isConnecting: boolean = false
	) {
		super(codespace.repository, collapsibleState);
		
		if (isConnecting) {
			// Show connecting state
			this.description = 'Connecting...';
			this.tooltip = `Connecting to ${codespace.displayName || codespace.name}...`;
			this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
			// Disable command while connecting
			this.command = undefined;
		} else {
			this.tooltip = `${codespace.displayName || codespace.name}\nState: ${codespace.state}\nRepository: ${codespace.repository}`;
			this.description = codespace.state;
			
			// Set icon based on state
			if (codespace.state === 'Available') {
				this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
			} else if (codespace.state === 'Shutdown') {
				this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.red'));
			} else {
				this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
			}
			
			// Add context menu command
			this.contextValue = 'codespace';
			// Pass the tree item itself so we can extract the codespace
			this.command = {
				command: 'cursorCodespaces.connectToCodespaceFromExplorer',
				title: 'Connect to Codespace',
				arguments: [this]
			};
		}
	}
}

export class InstallationInstructionsTreeItem extends vscode.TreeItem {
	constructor() {
		super('GitHub CLI is not installed', vscode.TreeItemCollapsibleState.None);
		
		this.description = 'Click to install';
		this.tooltip = 'GitHub CLI (gh) is required to use this extension.\n\nClick to open the installation page.';
		this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
		this.command = {
			command: 'vscode.open',
			title: 'Install GitHub CLI',
			arguments: [vscode.Uri.parse('https://cli.github.com/')]
		};
	}
}

export class AuthenticationRequiredTreeItem extends vscode.TreeItem {
	constructor() {
		super('GitHub authentication required', vscode.TreeItemCollapsibleState.None);
		
		this.description = 'Click to login';
		this.tooltip = 'You need to authenticate with GitHub CLI.\n\nClick to open a terminal with the login command.\nAfter completing authentication, click the refresh button (🔄) in the explorer title bar.';
		this.iconPath = new vscode.ThemeIcon('key', new vscode.ThemeColor('charts.orange'));
		this.command = {
			command: 'cursorCodespaces.openAuthTerminal',
			title: 'Authenticate with GitHub',
			arguments: ['gh auth login']
		};
	}
}

export class ScopeRequiredTreeItem extends vscode.TreeItem {
	constructor() {
		super('Additional GitHub scopes required', vscode.TreeItemCollapsibleState.None);
		
		this.description = 'Click to refresh scopes';
		this.tooltip = 'You need to grant the codespace scope.\n\nClick to open a terminal with the refresh command.\nAfter completing the refresh, click the refresh button (🔄) in the explorer title bar.';
		this.iconPath = new vscode.ThemeIcon('key', new vscode.ThemeColor('charts.orange'));
		this.command = {
			command: 'cursorCodespaces.openAuthTerminal',
			title: 'Refresh GitHub Scopes',
			arguments: ['gh auth refresh -h github.com -s codespace']
		};
	}
}

export class RemoteSshRequiredTreeItem extends vscode.TreeItem {
	constructor() {
		super('Remote-SSH extension is not installed', vscode.TreeItemCollapsibleState.None);
		
		this.description = 'Click to install';
		this.tooltip = 'Remote-SSH extension is required to connect to Codespaces.\n\nClick to open the extension marketplace.\nAfter installation, click the refresh button (🔄) in the explorer title bar.';
		this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
		this.command = {
			command: 'cursorCodespaces.openRemoteSshExtension',
			title: 'Install Remote-SSH',
			arguments: []
		};
	}
}

type ExplorerTreeItem = CodespaceTreeItem | InstallationInstructionsTreeItem | AuthenticationRequiredTreeItem | ScopeRequiredTreeItem | RemoteSshRequiredTreeItem;

export class CodespaceExplorerProvider implements vscode.TreeDataProvider<ExplorerTreeItem>, vscode.Disposable {
	private _onDidChangeTreeData: vscode.EventEmitter<ExplorerTreeItem | undefined | null | void> = new vscode.EventEmitter<ExplorerTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<ExplorerTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private ghService: GhService;
	private remoteSshBridge: RemoteSshBridge;
	private connectingCodespaces: Set<string> = new Set(); // Track which codespaces are connecting
	private pollingInterval: NodeJS.Timeout | undefined;
	private readonly POLL_INTERVAL_MS = 3000; // Poll every 3 seconds when there's an error

	constructor() {
		this.ghService = GhService.getInstance();
		this.remoteSshBridge = RemoteSshBridge.getInstance();
	}

	dispose(): void {
		this.stopPolling();
	}

	private startPolling(): void {
		// Only start polling if not already polling
		if (this.pollingInterval) {
			return;
		}

		this.pollingInterval = setInterval(() => {
			this.refresh();
		}, this.POLL_INTERVAL_MS);
	}

	private stopPolling(): void {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = undefined;
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	setConnecting(codespaceName: string, isConnecting: boolean): void {
		if (isConnecting) {
			this.connectingCodespaces.add(codespaceName);
		} else {
			this.connectingCodespaces.delete(codespaceName);
		}
		this._onDidChangeTreeData.fire();
	}

	isConnecting(codespaceName: string): boolean {
		return this.connectingCodespaces.has(codespaceName);
	}

	getTreeItem(element: ExplorerTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ExplorerTreeItem): Promise<ExplorerTreeItem[]> {
		// First check if GitHub CLI is installed
		const ghInstalled = await this.ghService.checkGhInstalled();
		if (!ghInstalled) {
			// Return installation instructions
			return [
				new InstallationInstructionsTreeItem()
			];
		}

		try {
			// Always fetch fresh codespace list
			const codespaces = await this.ghService.listCodespaces();
			
			// Successfully loaded codespaces - stop polling
			this.stopPolling();
			
			// Check if Remote-SSH is available before showing codespaces
			const remoteSshAvailable = await this.remoteSshBridge.checkRemoteSshAvailable();
			if (!remoteSshAvailable) {
				// Start polling to automatically refresh when Remote-SSH is installed
				this.startPolling();
				return [
					new RemoteSshRequiredTreeItem()
				];
			}
			
			if (codespaces.length === 0) {
				return [];
			}

			// Return all codespaces as tree items, checking if any are connecting
			return codespaces.map(codespace => {
				const isConnecting = this.isConnecting(codespace.name);
				return new CodespaceTreeItem(codespace, vscode.TreeItemCollapsibleState.None, isConnecting);
			});
		} catch (error: any) {
			// Handle specific error types and show helpful messages
			if (error.name === 'AuthenticationError' || error.message === 'AUTHENTICATION_REQUIRED') {
				// Start polling to automatically refresh when authentication is complete
				this.startPolling();
				return [
					new AuthenticationRequiredTreeItem()
				];
			}
			
			if (error.name === 'ScopeError' || error.message === 'SCOPE_REQUIRED') {
				// Start polling to automatically refresh when scopes are granted
				this.startPolling();
				return [
					new ScopeRequiredTreeItem()
				];
			}
			
			// For other errors, stop polling and log but don't show anything (to avoid cluttering)
			this.stopPolling();
			console.error('Failed to load codespaces:', error);
			return [];
		}
	}
}

