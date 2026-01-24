import * as vscode from 'vscode';
import { Collection } from './collection';
import { LocalCollection } from './local_collection';
import { TTRSSCollection } from './ttrss_collection';
import { join as pathJoin } from 'path';
import { readFile, TTRSSApiURL, walkFeedTree, writeFile } from './utils';
import { AccountList, Account } from './account';
import { FeedList, Feed } from './feeds';
import { ArticleList, Article } from './articles';
import { FavoritesList, Item } from './favorites';
import { Abstract } from './content';
import * as uuid from 'uuid';
import { StatusBar } from './status_bar';
import { InoreaderCollection } from './inoreader_collection';
import { assert } from 'console';
import { parseOPML } from './parser';
import { AIBriefPanel } from './ai_brief_panel';

export class App {
    private static _instance?: App;

    private current_account?: string;
    private current_feed?: string;
    private updating = false;

    private account_list = new AccountList();
    private feed_list = new FeedList();
    private article_list = new ArticleList();
    private favorites_list = new FavoritesList();
    private ai_brief_panel: AIBriefPanel;

    private article_tree_view?: vscode.TreeView<Article>;

    private status_bar = new StatusBar();

    public collections: { [key: string]: Collection } = {};

    private constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly root: string,
    ) {
        this.ai_brief_panel = new AIBriefPanel(context);
    }

    private async initAccounts() {
        let keys = Object.keys(App.cfg.accounts);
        if (keys.length <= 0) {
            await this.createLocalAccount('Default');
            keys = Object.keys(App.cfg.accounts);
        }
        for (const key of keys) {
            if (this.collections[key]) {
                continue;
            }
            const account = App.cfg.accounts[key];
            const dir = pathJoin(this.root, key);
            let c: Collection;
            switch (account.type) {
                case 'local':
                    c = new LocalCollection(dir, key);
                    break;
                case 'ttrss':
                    c = new TTRSSCollection(dir, key);
                    break;
                case 'inoreader':
                    c = new InoreaderCollection(dir, key);
                    break;
                default:
                    throw new Error(`Unknown account type: ${account.type}`);
            }
            await c.init();
            this.collections[key] = c;
        }
        for (const key in this.collections) {
            if (!(key in App.cfg.accounts)) {
                delete this.collections[key];
            }
        }
        if (this.current_account === undefined || !(this.current_account in this.collections)) {
            this.current_account = Object.keys(this.collections)[0];
        }
    }

    private async createLocalAccount(name: string) {
        const accounts = App.cfg.get<any>('accounts');
        accounts[uuid.v1()] = {
            name: name,
            type: 'local',
            feeds: [],
        };
        await App.cfg.update('accounts', accounts, true);
    }

    private async createTTRSSAccount(name: string, server: string, username: string, password: string) {
        const accounts = App.cfg.get<any>('accounts');
        accounts[uuid.v1()] = {
            name: name,
            type: 'ttrss',
            server,
            username,
            password,
        };
        await App.cfg.update('accounts', accounts, true);
    }

    private async createInoreaderAccount(name: string, appid: string, appkey: string) {
        const accounts = App.cfg.get<any>('accounts');
        accounts[uuid.v1()] = {
            name: name,
            type: 'inoreader',
            appid, appkey,
        };
        await App.cfg.update('accounts', accounts, true);
    }

    private async removeAccount(key: string) {
        const collection = this.collections[key];
        if (collection === undefined) {
            return;
        }
        await collection.clean();
        delete this.collections[key];

        const accounts = { ...App.cfg.get<any>('accounts') };
        delete accounts[key];
        await App.cfg.update('accounts', accounts, true);
    }

    async init() {
        await this.initAccounts();
    }

    static async initInstance(context: vscode.ExtensionContext, root: string) {
        App._instance = new App(context, root);
        await App.instance.init();
    }

    static get instance(): App {
        return App._instance!;
    }

    static get cfg() {
        return vscode.workspace.getConfiguration('rss');
    }

    public static readonly ACCOUNT = 1;
    public static readonly FEED = 1 << 1;
    public static readonly ARTICLE = 1 << 2;
    public static readonly FAVORITES = 1 << 3;
    public static readonly STATUS_BAR = 1 << 4;

    refreshLists(list: number = 0b11111) {
        if (list & App.ACCOUNT) {
            this.account_list.refresh();
        }
        if (list & App.FEED) {
            this.feed_list.refresh();
        }
        if (list & App.ARTICLE) {
            this.article_list.refresh();
        }
        if (list & App.FAVORITES) {
            this.favorites_list.refresh();
        }
        if (list & App.STATUS_BAR) {
            this.status_bar.refresh();
        }
    }

    currCollection() {
        return this.collections[this.current_account!];
    }

    currArticles() {
        if (this.current_feed === undefined) {
            return [];
        }
        return this.currCollection().getArticles(this.current_feed);
    }

    currFavorites() {
        return this.currCollection().getFavorites();
    }

    initViews() {
        vscode.window.registerTreeDataProvider('rss-accounts', this.account_list);
        vscode.window.registerTreeDataProvider('rss-feeds', this.feed_list);
        this.article_tree_view = vscode.window.createTreeView('rss-articles', {
            treeDataProvider: this.article_list
        });
        vscode.window.registerTreeDataProvider('rss-favorites', this.favorites_list);
        this.status_bar.init();
    }

    initCommands() {
        const commands: [string, (...args: any[]) => any][] = [
            ['rss.select', this.rss_select],
            ['rss.articles', this.rss_articles],
            ['rss.read', this.rss_read],
            ['rss.mark-read', this.rss_mark_read],
            ['rss.mark-unread', this.rss_mark_unread],
            ['rss.mark-all-read', this.rss_mark_all_read],
            ['rss.mark-account-read', this.rss_mark_account_read],
            ['rss.refresh', this.rss_refresh],
            ['rss.refresh-account', this.rss_refresh_account],
            ['rss.refresh-one', this.rss_refresh_one],
            ['rss.open-website', this.rss_open_website],
            ['rss.open-link', this.rss_open_link],
            ['rss.add-feed', this.rss_add_feed],
            ['rss.remove-feed', this.rss_remove_feed],
            ['rss.add-to-favorites', this.rss_add_to_favorites],
            ['rss.remove-from-favorites', this.rss_remove_from_favorites],
            ['rss.new-account', this.rss_new_account],
            ['rss.del-account', this.rss_del_account],
            ['rss.account-rename', this.rss_account_rename],
            ['rss.account-modify', this.rss_account_modify],
            ['rss.export-to-opml', this.rss_export_to_opml],
            ['rss.import-from-opml', this.rss_import_from_opml],
            ['rss.clean-old-articles', this.rss_clean_old_articles],
            ['rss.clean-all-old-articles', this.rss_clean_all_old_articles],
            ['rss.set-ai-api-key', this.rss_set_ai_api_key],
        ];

        for (const [cmd, handler] of commands) {
            this.context.subscriptions.push(
                vscode.commands.registerCommand(cmd, handler, this)
            );
        }
    }

    rss_select(account: string) {
        this.current_account = account;
        this.current_feed = undefined;

        // Reset article view title
        if (this.article_tree_view) {
            this.article_tree_view.title = 'Articles';
        }

        this.refreshLists(App.FEED | App.ARTICLE | App.FAVORITES);
    }

    rss_articles(feed: string) {
        this.current_feed = feed;

        // Update article view title
        if (this.article_tree_view) {
            let title = 'Articles';
            if (feed === '<unread>') {
                title = 'Articles (Unread)';
            } else {
                const summary = this.currCollection().getSummary(feed);
                if (summary) {
                    title = `Articles (${summary.title})`;
                }
            }
            this.article_tree_view.title = title;
        }

        this.refreshLists(App.ARTICLE);
    }

    private processMediaForButtonMode(content: string): string {
        content = content.replace(/<img([^>]*)>/gi, (match, attributes) => {
            const altMatch = attributes.match(/alt\s*=\s*["']([^"']*)["']/i);
            const altText = altMatch ? altMatch[1] : '';
            const buttonText = altText ? `${altText}(点击展示图片)` : '(点击展示图片)';

            return `<button class="image-placeholder-btn" data-original-img="${match.replace(/"/g, '&quot;')}" style="
                background-color: #f0f0f0;
                border: 1px solid #ccc;
                border-radius: 4px;
                padding: 8px 12px;
                cursor: pointer;
                font-size: 14px;
                color: #666;
                margin: 4px 0;
                display: inline-block;
            " onmouseover="this.style.backgroundColor='#e0e0e0'" onmouseout="this.style.backgroundColor='#f0f0f0'">${buttonText}</button>`;
        });

        return content.replace(/<(video|iframe)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tagName) => {
            const buttonText = '(点击展示视频)';
            return `<button class="image-placeholder-btn" data-original-img="${match.replace(/"/g, '&quot;')}" style="
                background-color: #f0f0f0;
                border: 1px solid #ccc;
                border-radius: 4px;
                padding: 8px 12px;
                cursor: pointer;
                font-size: 14px;
                color: #666;
                margin: 4px 0;
                display: inline-block;
            " onmouseover="this.style.backgroundColor='#e0e0e0'" onmouseout="this.style.backgroundColor='#f0f0f0'">${buttonText}</button>`;
        });
    }

    private getHTML(content: string, panel: vscode.WebviewPanel) {
        const fontFamily = App.cfg.get<string>('article-font-family') || '';
        const fontSize = App.cfg.get<string>('article-font-size') || '1em';

        let bodyStyle = `font-size:${fontSize};max-width:960px;margin:auto;`;
        if (fontFamily) {
            bodyStyle += `font-family:${fontFamily};`;
        }

        const css = `<style type="text/css">body{${bodyStyle}}</style>`;

        const showImages = App.cfg.get<boolean>('show-images');
        if (!showImages) {
            content = this.processMediaForButtonMode(content);
        }

        // Inject AI brief panel if feature is enabled
        const aiPanelHTML = this.ai_brief_panel.getHTML();

        const star_path = vscode.Uri.file(pathJoin(this.context.extensionPath, 'resources/star.svg'));
        const star_src = panel.webview.asWebviewUri(star_path);

        const web_path = vscode.Uri.file(pathJoin(this.context.extensionPath, 'resources/web.svg'));
        const web_src = panel.webview.asWebviewUri(web_path);

        let icon_offset = -2;

        let html = css + aiPanelHTML + content + `
        <style>
        .float-btn {
            width: 2.2rem;
            height: 2.2rem;
            position: fixed;
            right: 0.5rem;
            z-index: 9999;
            filter: drop-shadow(0 0 0.2rem rgba(0,0,0,.5));
            transition-duration: 0.3s;
        }
        .float-btn:hover {
            filter: drop-shadow(0 0 0.2rem rgba(0,0,0,.5))
                    brightness(130%);
        }
        .float-btn:active {
            filter: drop-shadow(0 0 0.2rem rgba(0,0,0,.5))
                    brightness(80%);
        }
        /* 自适应图片：如果图片小于容器就原尺寸显示，否则等比缩小适应容器 */
        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 4px 0;
        }
        ${this.ai_brief_panel.getStyles()}
        </style>
        <script type="text/javascript">
        const vscode = acquireVsCodeApi();
        let fontSizeOffset = 0; // 记录字体大小的偏移量（px）

        function star() {
            vscode.postMessage('star')
        }
        function next() {
            vscode.postMessage('next')
        }
        function web() {
            vscode.postMessage('web')
        }
        function increaseFontSize() {
            fontSizeOffset += 2;
            document.body.style.fontSize = 'calc(${fontSize} + ' + fontSizeOffset + 'px)';
        }
        function decreaseFontSize() {
            fontSizeOffset -= 2;
            document.body.style.fontSize = 'calc(${fontSize} + ' + fontSizeOffset + 'px)';
        }

        ${this.ai_brief_panel.getScript()}

        document.addEventListener('DOMContentLoaded', function() {
            document.addEventListener('click', function(event) {
                if (event.target.classList.contains('image-placeholder-btn')) {
                    const button = event.target;
                    const originalImg = button.getAttribute('data-original-img');
                    if (originalImg) {
                        // 创建临时元素来解析原始 HTML
                        const temp = document.createElement('div');
                        temp.innerHTML = originalImg;
                        const imgElement = temp.querySelector('img, video, iframe');
                        if (imgElement) {
                            // 给图片添加自适应样式类
                            if (imgElement.tagName === 'IMG') {
                                imgElement.classList.add('responsive-image');
                            }
                            button.outerHTML = imgElement.outerHTML;
                        } else {
                            // 如果不是 img/video/iframe，直接替换
                            button.outerHTML = originalImg;
                        }
                    }
                }
            });
        });
        </script>
        <img src="${web_src}" title="Open link" onclick="web()" class="float-btn" style="bottom:${icon_offset += 3}rem;"/>
        <img src="${star_src}" title="Add to favorites" onclick="star()" class="float-btn" style="bottom:${icon_offset += 3}rem;"/>
        `;
        if (this.currCollection().getArticles('<unread>').length > 0) {
            const next_path = vscode.Uri.file(pathJoin(this.context.extensionPath, 'resources/next.svg'));
            const next_src = panel.webview.asWebviewUri(next_path);
            html += `<img src="${next_src}" title="Next" onclick="next()" class="float-btn" style="bottom:${icon_offset += 3}rem;"/>`;
        }
        html += `<button onclick="decreaseFontSize()" class="float-btn" style="bottom:${icon_offset += 3}rem;background-color:rgba(255,255,255,0.9);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:bold;color:#333;" title="缩小字体">A-</button>`;
        html += `<button onclick="increaseFontSize()" class="float-btn" style="bottom:${icon_offset += 3}rem;background-color:rgba(255,255,255,0.9);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:bold;color:#333;" title="放大字体">A+</button>`;
        return html;
    }

    async rss_read(abstract: Abstract) {
        const content = await this.currCollection().getContent(abstract.id);
        const panel = vscode.window.createWebviewPanel(
            'rss', abstract.title, vscode.ViewColumn.Active,
            { retainContextWhenHidden: true, enableScripts: true });

        abstract.read = true;
        panel.title = abstract.title;
        panel.webview.html = this.getHTML(content, panel);
        panel.webview.onDidReceiveMessage(async (e) => {
            // Delegate AI brief messages to AIBriefPanel
            const handled = await this.ai_brief_panel.handleMessage(
                e,
                panel,
                abstract,
                () => this.currCollection().getContent(abstract.id)
            );

            if (handled) {
                return;
            }

            // Handle other messages
            if (e === 'web') {
                if (abstract.link) {
                    const openInBrowser = App.cfg.get<boolean>('open-in-browser');
                    if (openInBrowser) {
                        // Open in external browser
                        vscode.env.openExternal(vscode.Uri.parse(abstract.link));
                    } else {
                        // Open in VSCode simple browser (new tab)
                        vscode.commands.executeCommand('simpleBrowser.show', abstract.link);
                    }
                }
            } else if (e === 'star') {
                await this.currCollection().addToFavorites(abstract.id);
                this.refreshLists(App.FAVORITES);
            } else if (e === 'next') {
                const unread = this.currCollection().getArticles('<unread>');
                if (unread.length > 0) {
                    const abs = unread[0];
                    panel.dispose();
                    await this.rss_read(abs);
                }
            }
        });

        this.refreshLists();

        await this.currCollection().updateAbstract(abstract.id, abstract).commit();
    }

    async rss_mark_read(article: Article) {
        const abstract = article.abstract;
        abstract.read = true;
        this.refreshLists();

        await this.currCollection().updateAbstract(abstract.id, abstract).commit();
    }

    async rss_mark_unread(article: Article) {
        const abstract = article.abstract;
        abstract.read = false;
        this.refreshLists();

        await this.currCollection().updateAbstract(abstract.id, abstract).commit();
    }

    async rss_mark_all_read(feed?: Feed) {
        let abstracts: Abstract[];
        if (feed) {
            abstracts = this.currCollection().getArticles(feed.feed);
        } else {
            abstracts = this.currArticles();
        }
        for (const abstract of abstracts) {
            abstract.read = true;
            this.currCollection().updateAbstract(abstract.id, abstract);
        }
        this.refreshLists();

        await this.currCollection().commit();
    }

    async rss_mark_account_read(account?: Account) {
        const collection = account ?
            this.collections[account.key] : this.currCollection();
        for (const abstract of collection.getArticles('<unread>')) {
            abstract.read = true;
            collection.updateAbstract(abstract.id, abstract);
        }
        this.refreshLists();
        await collection.commit();
    }

    async rss_refresh(auto: boolean) {
        if (this.updating) {
            return;
        }
        this.updating = true;
        await vscode.window.withProgress({
            location: auto ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            await Promise.all(Object.values(this.collections).map(c => c.fetchAll(true)));
            this.refreshLists();
            this.updating = false;
        });
    }

    async rss_refresh_account(account?: Account) {
        if (this.updating) {
            return;
        }
        this.updating = true;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            const collection = account ?
                this.collections[account.key] : this.currCollection();
            await collection.fetchAll(true);
            this.refreshLists();
            this.updating = false;
        });
    }

    async rss_refresh_one(feed?: Feed) {
        if (this.updating) {
            return;
        }
        const url = feed ? feed.feed : this.current_feed;
        if (url === undefined) {
            return;
        }
        this.updating = true;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            await this.currCollection().fetchOne(url, true);
            this.refreshLists();
            this.updating = false;
        });
    }

    rss_open_website(feed: Feed) {
        vscode.env.openExternal(vscode.Uri.parse(feed.summary.link));
    }

    rss_open_link(article: Article) {
        if (article.abstract.link) {
            vscode.env.openExternal(vscode.Uri.parse(article.abstract.link));
        }
    }

    async rss_add_feed() {
        const feed = await vscode.window.showInputBox({ prompt: 'Enter the feed URL' });
        if (feed === undefined || feed.length <= 0) { return; }
        await this.currCollection().addFeed(feed);
    }

    async rss_remove_feed(feed: Feed) {
        await this.currCollection().delFeed(feed.feed);
    }

    async rss_add_to_favorites(article: Article) {
        await this.currCollection().addToFavorites(article.abstract.id);
        this.refreshLists(App.FAVORITES);
    }

    async rss_remove_from_favorites(item: Item) {
        await this.currCollection().removeFromFavorites(item.abstract.id);
        this.refreshLists(App.FAVORITES);
    }

    async rss_new_account() {
        const type = await vscode.window.showQuickPick(
            ['local', 'ttrss', 'inoreader'],
            { placeHolder: "Select account type" }
        );
        if (type === undefined) { return; }
        const name = await vscode.window.showInputBox({ prompt: 'Enter account name', value: type });
        if (name === undefined || name.length <= 0) { return; }

        if (type === 'local') {
            await this.createLocalAccount(name);
        } else if (type === 'ttrss') {
            const url = await vscode.window.showInputBox({ prompt: 'Enter server URL(SELF_URL_PATH)' });
            if (url === undefined || url.length <= 0) { return; }
            const username = await vscode.window.showInputBox({ prompt: 'Enter user name' });
            if (username === undefined || username.length <= 0) { return; }
            const password = await vscode.window.showInputBox({ prompt: 'Enter password', password: true });
            if (password === undefined || password.length <= 0) { return; }
            await this.createTTRSSAccount(name, TTRSSApiURL(url), username, password);
        } else if (type === 'inoreader') {
            const custom = await vscode.window.showQuickPick(
                ['no', 'yes'],
                { placeHolder: "Using custom app ID & app key?" }
            );
            let appid, appkey;
            if (custom === 'yes') {
                appid = await vscode.window.showInputBox({ prompt: 'Enter app ID' });
                if (!appid) { return; }
                appkey = await vscode.window.showInputBox({ prompt: 'Enter app key', password: true });
                if (!appkey) { return; }
            } else {
                appid = '999999367';
                appkey = 'GOgPzs1RnPTok6q8kC8HgmUPji3DjspC';
            }

            await this.createInoreaderAccount(name, appid, appkey);
        }
    }

    async rss_del_account(account: Account) {
        const confirm = await vscode.window.showQuickPick(['no', 'yes'], { placeHolder: "Are you sure to delete?" });
        if (confirm !== 'yes') {
            return;
        }
        await this.removeAccount(account.key);
    }

    async rss_account_rename(account: Account) {
        const name = await vscode.window.showInputBox({ prompt: 'Enter the name' });
        if (name === undefined || name.length <= 0) { return; }
        const accounts = App.cfg.get<any>('accounts');
        accounts[account.key].name = name;
        await App.cfg.update('accounts', accounts, true);
    }

    async rss_account_modify(account: Account) {
        const accounts = App.cfg.get<any>('accounts');
        if (account.type === 'ttrss') {
            const cfg = accounts[account.key] as TTRSSAccount;

            const url = await vscode.window.showInputBox({
                prompt: 'Enter server URL(SELF_URL_PATH)',
                value: cfg.server.substr(0, cfg.server.length - 4)
            });
            if (url === undefined || url.length <= 0) { return; }
            const username = await vscode.window.showInputBox({
                prompt: 'Enter user name', value: cfg.username
            });
            if (username === undefined || username.length <= 0) { return; }
            const password = await vscode.window.showInputBox({
                prompt: 'Enter password', password: true, value: cfg.password
            });
            if (password === undefined || password.length <= 0) { return; }

            cfg.server = TTRSSApiURL(url);
            cfg.username = username;
            cfg.password = password;
        } else if (account.type === 'inoreader') {
            const cfg = accounts[account.key] as InoreaderAccount;

            const appid = await vscode.window.showInputBox({
                prompt: 'Enter app ID', value: cfg.appid
            });
            if (!appid) { return; }
            const appkey = await vscode.window.showInputBox({
                prompt: 'Enter app key', password: true, value: cfg.appkey
            });
            if (!appkey) { return; }

            cfg.appid = appid;
            cfg.appkey = appkey;
        }

        await App.cfg.update('accounts', accounts, true);
    }

    async rss_export_to_opml(account: Account) {
        const collection = this.collections[account.key];
        const path = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(collection.name + '.opml')
        });
        if (!path) {
            return;
        }

        const tree = collection.getFeedList();
        const outlines: string[] = [];
        for (const feed of walkFeedTree(tree)) {
            const summary = collection.getSummary(feed);
            if (!summary) {
                continue;
            }
            outlines.push(`<outline text="${summary.title}" title="${summary.title}" type="rss" xmlUrl="${feed}" htmlUrl="${summary.link}"/>`);
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>`
            + `<opml version="1.0">`
            + `<head><title>${collection.name}</title></head>`
            + `<body>${outlines.join('')}</body>`
            + `</opml>`;

        await writeFile(path.fsPath, xml);
    }

    async rss_import_from_opml(account: Account) {
        const collection = this.collections[account.key] as LocalCollection;
        assert(collection.type === 'local');
        const paths = await vscode.window.showOpenDialog({ canSelectMany: false });
        if (!paths) {
            return;
        }

        const xml = await readFile(paths[0].fsPath);
        await collection.addFeeds(parseOPML(xml));
    }

    private async selectExpire(): Promise<number | undefined> {
        const s = ['1 month', '2 months', '3 months', '6 months'];
        const t = [1 * 30, 2 * 30, 3 * 30, 6 * 30];
        const time = await vscode.window.showQuickPick(s, {
            placeHolder: "Choose a time. Unread and favorite articles will be kept."
        });
        if (!time) {
            return undefined;
        }
        return t[s.indexOf(time)] * 86400 * 1000;
    }

    async rss_clean_old_articles(feed: Feed) {
        const exprie = await this.selectExpire();
        if (!exprie) {
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cleaning...",
            cancellable: false
        }, async () => {
            await this.currCollection().cleanOldArticles(feed.feed, exprie);
        });
        this.refreshLists(App.ARTICLE | App.STATUS_BAR);
    }

    async rss_clean_all_old_articles(account: Account) {
        const expire = await this.selectExpire();
        if (!expire) {
            return;
        }
        const collection = this.collections[account.key];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cleaning...",
            cancellable: false
        }, async () => {
            await collection.cleanAllOldArticles(expire);
        });
        this.refreshLists(App.ARTICLE | App.STATUS_BAR);
    }

    initEvents() {
        const do_refresh = () => vscode.commands.executeCommand('rss.refresh', true);
        let timer = setInterval(do_refresh, App.cfg.interval * 1000);

        const disposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('rss.interval')) {
                clearInterval(timer);
                timer = setInterval(do_refresh, App.cfg.interval * 1000);
            }

            if (e.affectsConfiguration('rss.status-bar-notify') || e.affectsConfiguration('rss.status-bar-update')) {
                this.refreshLists(App.STATUS_BAR);
            }

            if (e.affectsConfiguration('rss.accounts') && !this.updating) {
                this.updating = true;
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Updating RSS...",
                    cancellable: false
                }, async () => {
                    await this.initAccounts();
                    await Promise.all(Object.values(this.collections).map(c => c.fetchAll(false)));
                    this.refreshLists();
                    this.updating = false;
                });
            }

            if (e.affectsConfiguration('rss.storage-path')) {
                const res = await vscode.window.showInformationMessage("Reload vscode to take effect", "Reload");
                if (res === "Reload") {
                    vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
            }

        });
        this.context.subscriptions.push(disposable);
    }

    async rss_set_ai_api_key() {
        const configManager = this.ai_brief_panel['configManager'] as import('./ai_config').AIConfigManager;
        await configManager.promptForApiKey();
    }
}
