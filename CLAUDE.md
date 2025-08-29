# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode-RSS is a Visual Studio Code extension that provides an embedded RSS reader. The extension supports multiple account types (local, Tiny Tiny RSS, and Inoreader) and allows users to read news and blog posts directly within VSCode.

## Development Commands

### Build and Compile
- `npm run compile` - Compile TypeScript to JavaScript in ./out directory
- `npm run compile-release` - Production build using webpack (clears ./out first)
- `npm run vscode:prepublish` - Production build (alias for compile-release)

### Testing and Quality
- `npm run lint` - Run ESLint on TypeScript files in src/
- `npm run pretest` - Run compile and lint before testing
- `npm test` - Run the test suite using Mocha

### Development Workflow
When making changes to the codebase, always run:
1. `npm run compile` (for development) or `npm run compile-release` (for production)
2. `npm run lint` to ensure code quality
3. `npm test` to verify functionality

## Architecture Overview

### Core Components

**App Class (src/app.ts)**
- Singleton main application controller
- Manages multiple account collections and UI state
- Initializes views, commands, and event handlers
- Handles RSS refresh intervals and configuration changes
- Current account/feed state management

**Collection System**
- Abstract base class: `Collection` (src/collection.ts)
- Concrete implementations:
  - `LocalCollection` (src/local_collection.ts) - File-based storage
  - `TTRSSCollection` (src/ttrss_collection.ts) - Tiny Tiny RSS API integration
  - `InoreaderCollection` (src/inoreader_collection.ts) - Inoreader API integration

**Data Models**
- `Summary` - Feed metadata and article catalog
- `Abstract` - Article metadata (title, date, read status, etc.)
- `Entry` - Full article content during parsing

**UI Components**
- `AccountList` - Account tree view provider
- `FeedList` - Feed tree view provider  
- `ArticleList` - Article list view provider
- `FavoritesList` - Favorites view provider
- `StatusBar` - Status bar notifications

### Key Design Patterns

**Account Management**
- Each account type has its own Collection subclass
- Account data stored in VSCode configuration (`rss.accounts`)
- Each account gets a unique UUID key and storage directory

**Data Synchronization**
- Collections manage local caching and remote sync
- Dirty tracking for efficient commits
- ETags for HTTP caching (LocalCollection)
- Session management for authenticated APIs (TTRSS/Inoreader)

**Content Storage**
- Feed summaries: `{storageDir}/{accountId}/feeds/{encodedUrl}`
- Article content: `{storageDir}/{accountId}/articles/{articleId}`
- JSON serialization for structured data

### Extension Integration

**Commands**
All commands prefixed with `rss.` and registered in package.json. Key commands:
- Account management: `new-account`, `del-account`, `refresh-account`
- Feed management: `add-feed`, `remove-feed`, `refresh-one`
- Article actions: `read`, `mark-read`, `add-to-favorites`

**Views**
Four tree view containers under "RSS Reader" activity bar:
- Accounts, Feeds, Articles, Favorites

**Configuration**
Settings under `rss.*` namespace including intervals, timeouts, storage paths, and account credentials.

## File Structure Notes

- `src/extension.ts` - Extension entry point, calls App.initInstance()
- `src/parser.ts` - XML/RSS parsing logic
- `src/content.ts` - Data model definitions  
- `src/utils.ts` - HTTP client, file operations, helper functions
- `src/config.ts` - Configuration management
- `src/migrate.ts` - Data migration between versions
- `src/test/` - Test files using Mocha

## Development Guidelines

- TypeScript strict mode enabled
- Use existing HTTP client wrapper (`got` via utils.ts)
- Follow existing error handling patterns with vscode.window.showErrorMessage
- Maintain backwards compatibility for account data structures
- Use App.cfg for configuration access
- Follow existing refresh/update patterns for UI consistency