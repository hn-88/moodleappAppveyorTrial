// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { IonicPage, Platform, NavParams } from 'ionic-angular';
import { TranslateService } from '@ngx-translate/core';
import { CoreEventsProvider } from '@providers/events';
import { CoreSitesProvider } from '@providers/sites';
import { AddonMessagesProvider } from '../../providers/messages';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreAppProvider } from '@providers/app';
import { AddonPushNotificationsDelegate } from '@addon/pushnotifications/providers/delegate';
import { CoreSplitViewComponent } from '@components/split-view/split-view';

/**
 * Page that displays the list of conversations, including group conversations.
 */
@IonicPage({ segment: 'addon-messages-group-conversations' })
@Component({
    selector: 'page-addon-messages-group-conversations',
    templateUrl: 'group-conversations.html',
})
export class AddonMessagesGroupConversationsPage implements OnInit, OnDestroy {
    @ViewChild(CoreSplitViewComponent) splitviewCtrl: CoreSplitViewComponent;

    loaded = false;
    loadingMessage: string;
    selectedConversation: number;
    search = {
        enabled: false,
        showResults: false,
        results: [],
        loading: '',
        text: ''
    };
    favourites: any = {
        type: null,
        favourites: true
    };
    group: any = {
        type: AddonMessagesProvider.MESSAGE_CONVERSATION_TYPE_GROUP,
        favourites: false
    };
    individual: any = {
        type: AddonMessagesProvider.MESSAGE_CONVERSATION_TYPE_INDIVIDUAL,
        favourites: false
    };

    protected loadingString: string;
    protected siteId: string;
    protected currentUserId: number;
    protected conversationId: number;
    protected newMessagesObserver: any;
    protected pushObserver: any;
    protected appResumeSubscription: any;
    protected readChangedObserver: any;
    protected cronObserver: any;

    constructor(private eventsProvider: CoreEventsProvider, sitesProvider: CoreSitesProvider, translate: TranslateService,
            private messagesProvider: AddonMessagesProvider, private domUtils: CoreDomUtilsProvider, navParams: NavParams,
            private appProvider: CoreAppProvider, platform: Platform, utils: CoreUtilsProvider,
            pushNotificationsDelegate: AddonPushNotificationsDelegate) {

        this.search.loading =  translate.instant('core.searching');
        this.loadingString = translate.instant('core.loading');
        this.siteId = sitesProvider.getCurrentSiteId();
        this.currentUserId = sitesProvider.getCurrentSiteUserId();
        this.conversationId = navParams.get('conversationId') || false;

        // Update conversations when new message is received.
        this.newMessagesObserver = eventsProvider.on(AddonMessagesProvider.NEW_MESSAGE_EVENT, (data) => {
            if (data.conversationId) {
                // Search the conversation to update.
                const conversation = this.findConversation(data.conversationId);

                if (typeof conversation == 'undefined') {
                    // Probably a new conversation, refresh the list.
                    this.loaded = false;
                    this.refreshData().finally(() => {
                        this.loaded = true;
                    });
                } else {
                    // An existing conversation has a new message, update the last message.
                    conversation.lastmessage = data.message;
                    conversation.lastmessagedate = data.timecreated / 1000;
                }
            }
        }, this.siteId);

        // Update discussions when a message is read.
        this.readChangedObserver = eventsProvider.on(AddonMessagesProvider.READ_CHANGED_EVENT, (data) => {
            if (data.conversationId) {
                const conversation = this.findConversation(data.conversationId);

                if (typeof conversation != 'undefined') {
                    // A discussion has been read reset counter.
                    conversation.unreadcount = 0;

                    // Discussions changed, invalidate them.
                    this.messagesProvider.invalidateConversations();
                }
            }
        }, this.siteId);

        // Update discussions when cron read is executed.
        this.cronObserver = eventsProvider.on(AddonMessagesProvider.READ_CRON_EVENT, (data) => {
            this.refreshData();
        }, this.siteId);

        // Refresh the view when the app is resumed.
        this.appResumeSubscription = platform.resume.subscribe(() => {
            if (!this.loaded) {
                return;
            }
            this.loaded = false;
            this.refreshData().finally(() => {
                this.loaded = true;
            });
        });

        // If a message push notification is received, refresh the view.
        this.pushObserver = pushNotificationsDelegate.on('receive').subscribe((notification) => {
            // New message received. If it's from current site, refresh the data.
            if (utils.isFalseOrZero(notification.notif) && notification.site == this.siteId) {
                this.refreshData();
            }
        });
    }

    /**
     * Component loaded.
     */
    ngOnInit(): void {
        if (this.conversationId) {
            // There is a discussion to load, open the discussion in a new state.
            this.gotoConversation(this.conversationId);
        }

        this.fetchData().then(() => {
            if (!this.conversationId && this.splitviewCtrl.isOn()) {
                // Load the first conversation.
                let conversation;

                if (this.favourites.expanded) {
                    conversation = this.favourites.conversations[0];
                } else if (this.group.expanded) {
                    conversation = this.group.conversations[0];
                } else if (this.individual.expanded) {
                    conversation = this.individual.conversations[0];
                }

                if (conversation) {
                    this.gotoConversation(conversation.id);
                }
            }
        });
    }

    /**
     * Fetch conversations.
     *
     * @return {Promise<any>} Promise resolved when done.
     */
    protected fetchData(): Promise<any> {
        this.loadingMessage = this.loadingString;
        this.search.enabled = this.messagesProvider.isSearchMessagesEnabled();

        // Load the first conversations of each type.
        const promises = [];

        promises.push(this.fetchDataForOption(this.favourites, false));
        promises.push(this.fetchDataForOption(this.group, false));
        promises.push(this.fetchDataForOption(this.individual, false));

        return Promise.all(promises).then(() => {
            if (typeof this.favourites.expanded == 'undefined') {
                // The expanded status hasn't been initialized. Do it now.
                this.favourites.expanded = this.favourites.count != 0;
                this.group.expanded = this.favourites.count == 0 && this.group.count != 0;
                this.individual.expanded = this.favourites.count == 0 && this.group.count == 0;
            }
        }).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.messages.errorwhileretrievingdiscussions', true);
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Fetch data for a certain option.
     *
     * @param {any} option The option to fetch data for.
     * @param {boolean} [loadingMore} Whether we are loading more data or just the first ones.
     * @return {Promise<any>} Promise resolved when done.
     */
    fetchDataForOption(option: any, loadingMore?: boolean): Promise<void> {
        const limitFrom = loadingMore ? option.conversations.length : 0;

        return this.messagesProvider.getConversations(option.type, option.favourites, limitFrom).then((data) => {
            if (loadingMore) {
                option.conversations = option.conversations.concat(data.conversations);
            } else {
                option.count = data.canLoadMore ? AddonMessagesProvider.LIMIT_MESSAGES + '+' : data.conversations.length;
                option.conversations = data.conversations;
            }

            option.unread = 0; // @todo.
            option.canLoadMore = data.canLoadMore;
        });
    }

    /**
     * Find a conversation in the list of loaded conversations.
     *
     * @param {number} conversationId The conversation ID to search.
     * @return {any} Conversation.
     */
    protected findConversation(conversationId: number): any {
        const conversations = (this.favourites.conversations || []).concat(this.group.conversations || [])
                .concat(this.individual.conversations || []);

        return conversations.find((conv) => {
            return conv.id == conversationId;
        });
    }

    /**
     * Navigate to contacts view.
     */
    gotoContacts(): void {
        this.splitviewCtrl.getMasterNav().push('AddonMessagesContactsPage');
    }

    /**
     * Navigate to a particular conversation.
     *
     * @param {number} conversationId Conversation Id to load.
     * @param {number} userId User of the conversation. Only if there is no conversationId.
     * @param {number} [messageId] Message to scroll after loading the discussion. Used when searching.
     */
    gotoConversation(conversationId: number, userId?: number, messageId?: number): void {
        this.selectedConversation = conversationId;

        const params = {
            conversationId: conversationId,
            userId: userId
        };
        if (messageId) {
            params['message'] = messageId;
        }
        this.splitviewCtrl.push('AddonMessagesDiscussionPage', params);
    }

    /**
     * Navigate to message settings.
     */
    gotoSettings(): void {
        this.splitviewCtrl.push('AddonMessagesSettingsPage');
    }

    /**
     * Function to load more conversations.
     *
     * @param {any} option The option to fetch data for.
     * @param {any} [infiniteComplete] Infinite scroll complete function. Only used from core-infinite-loading.
     * @return {Promise<any>} Resolved when done.
     */
    loadMoreConversations(option: any, infiniteComplete?: any): Promise<any> {
        return this.fetchDataForOption(option, true).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.messages.errorwhileretrievingdiscussions', true);
            option.canLoadMore = false;
        }).finally(() => {
            infiniteComplete && infiniteComplete();
        });
    }

    /**
     * Refresh the data.
     *
     * @param {any} [refresher] Refresher.
     * @return {Promise<any>} Promise resolved when done.
     */
    refreshData(refresher?: any): Promise<any> {
        return this.messagesProvider.invalidateConversations().then(() => {
            return this.fetchData().finally(() => {
                if (refresher) {
                    // Actions to take if refresh comes from the user.
                    this.eventsProvider.trigger(AddonMessagesProvider.READ_CHANGED_EVENT, undefined, this.siteId);
                    refresher.complete();
                }
            });
        });
    }

    /**
     * Toogle the visibility of an option (expand/collapse).
     *
     * @param {any} option The option to expand/collapse.
     */
    toggle(option: any): void {
        if (option.expanded) {
            // Already expanded, close it.
            option.expanded = false;
        } else {
            // Collapse all and expand the clicked one.
            this.favourites.expanded = false;
            this.group.expanded = false;
            this.individual.expanded = false;
            option.expanded = true;
        }
    }

    /**
     * Clear search and show conversations again.
     */
    clearSearch(): void {
        this.loaded = false;
        this.search.showResults = false;
        this.search.text = ''; // Reset searched string.
        this.fetchData().finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Search messages cotaining text.
     *
     * @param  {string}       query Text to search for.
     * @return {Promise<any>}       Resolved when done.
     */
    searchMessage(query: string): Promise<any> {
        this.appProvider.closeKeyboard();
        this.loaded = false;
        this.loadingMessage = this.search.loading;

        return this.messagesProvider.searchMessages(query).then((searchResults) => {
            this.search.showResults = true;
            this.search.results = searchResults;
        }).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.messages.errorwhileretrievingmessages', true);
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Page destroyed.
     */
    ngOnDestroy(): void {
        this.newMessagesObserver && this.newMessagesObserver.off();
        this.appResumeSubscription && this.appResumeSubscription.unsubscribe();
        this.pushObserver && this.pushObserver.unsubscribe();
        this.readChangedObserver && this.readChangedObserver.off();
        this.cronObserver && this.cronObserver.off();
    }
}
