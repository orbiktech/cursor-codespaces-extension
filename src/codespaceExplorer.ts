import * as vscode from 'vscode';
import { Codespace, GhService } from './ghService';

export class CodespaceTreeItem extends vscode.TreeItem {
	constructor(
		public readonly codespace: Codespace,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly isConnecting: boolean = false
	) {
		super(codespace.repository, collapsibleState);
		
		if (isConnecting) {
			// Show connecting state
			this.label = `$(sync~spin) ${codespace.repository}`;
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

export class CodespaceExplorerProvider implements vscode.TreeDataProvider<CodespaceTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<CodespaceTreeItem | undefined | null | void> = new vscode.EventEmitter<CodespaceTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<CodespaceTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private ghService: GhService;
	private connectingCodespaces: Set<string> = new Set(); // Track which codespaces are connecting

	constructor() {
		this.ghService = GhService.getInstance();
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

	getTreeItem(element: CodespaceTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: CodespaceTreeItem): Promise<CodespaceTreeItem[]> {
		try {
			// Always fetch fresh codespace list
			const codespaces = await this.ghService.listCodespaces();
			
			if (codespaces.length === 0) {
				return [];
			}

			// Return all codespaces as tree items, checking if any are connecting
			return codespaces.map(codespace => {
				const isConnecting = this.isConnecting(codespace.name);
				return new CodespaceTreeItem(codespace, vscode.TreeItemCollapsibleState.None, isConnecting);
			});
		} catch (error: any) {
			// If there's an error, show a message but don't crash
			console.error('Failed to load codespaces:', error);
			return [];
		}
	}
}

