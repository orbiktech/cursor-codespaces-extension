# Change Log

All notable changes to the "cursor-codespaces" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.3.0] - 2024-12-XX

### Added
- **Installation Instructions in Sidebar**: When GitHub CLI is not installed, the sidebar now shows helpful installation instructions with a direct link to download
- **Authentication Error Handling**: The sidebar now displays clear messages when GitHub CLI authentication is required or when additional scopes are needed
- **Automatic Refresh Polling**: The explorer automatically refreshes every 3 seconds when authentication/scope errors are detected, eliminating the need for manual refresh
- **One-Click Authentication**: Clicking authentication/scope error messages opens a terminal with the required command pre-filled
- **Remote-SSH Installation Prompt**: When Remote-SSH extension is missing, users are prompted to install it with a direct link to the marketplace
- **Linux Platform Support**: Improved compatibility with Linux systems including proper SSH config permissions handling and shell execution

### Improved
- **Error Detection**: Enhanced error detection for authentication and scope issues, including better pattern matching for GitHub CLI error messages
- **User Experience**: Clearer error messages and tooltips throughout the extension
- **Explorer Refresh**: Explorer now refreshes automatically when the sidebar becomes visible
- **Initial Load**: Fixed issue where explorer wouldn't show content on first activation without restart

### Fixed
- **Empty Sidebar on Fresh Install**: Fixed issue where sidebar showed nothing when GitHub CLI was installed but not authenticated
- **Manual Refresh Required**: Fixed issue where users had to manually refresh after completing authentication - now auto-refreshes
- **Linux SSH Permissions**: Fixed SSH config file and directory permissions handling on Linux systems
- **Shell Execution**: Improved shell command execution for better PATH resolution on Linux
- **Icon Display**: Removed incorrect icon syntax from tree item labels that was displaying as text

## [0.2.2] - 2024-XX-XX

- Initial release