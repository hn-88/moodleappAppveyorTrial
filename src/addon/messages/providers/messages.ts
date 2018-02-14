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

import { Injectable } from '@angular/core';
import { CoreLoggerProvider } from '../../../providers/logger';
import { CoreSitesProvider } from '../../../providers/sites';
import { CoreAppProvider } from '../../../providers/app';
import { CoreUserProvider } from '../../../core/user/providers/user';
import { AddonMessagesOfflineProvider } from './messages-offline';
import { CoreUtilsProvider } from '../../../providers/utils/utils';
import { CoreTimeUtilsProvider } from '../../../providers/utils/time';

/**
 * Service to handle messages.
 */
@Injectable()
export class AddonMessagesProvider {
    protected ROOT_CACHE_KEY = 'mmaMessages:';
    protected LIMIT_MESSAGES = 50;
    static NEW_MESSAGE_EVENT = 'new_message_event';
    static READ_CHANGED_EVENT = 'read_changed_event';
    static READ_CRON_EVENT = 'read_cron_event';
    static SPLIT_VIEW_LOAD_EVENT = 'split_view_load_event';
    static POLL_INTERVAL = 10000;

    protected logger;

    constructor(logger: CoreLoggerProvider, private sitesProvider: CoreSitesProvider, private appProvider: CoreAppProvider,
            private userProvider: CoreUserProvider, private messagesOffline: AddonMessagesOfflineProvider,
            private utils: CoreUtilsProvider, private timeUtils: CoreTimeUtilsProvider) {
        this.logger = logger.getInstance('AddonMessagesProvider');
    }

    /**
     * Delete a message (online or offline).
     *
     * @param {any} message    Message to delete.
     * @return {Promise<any>}  Promise resolved when the message has been deleted.
     */
    deleteMessage(message: any): Promise<any> {
        if (message.id) {
            // Message has ID, it means it has been sent to the server.
            return this.deleteMessageOnline(message.id, message.read);
        }

        // It's an offline message.
        return this.messagesOffline.deleteMessage(message.touserid, message.smallmessage, message.timecreated);
    }

    /**
     * Delete a message from the server.
     *
     * @param {number} id       Message ID.
     * @param {number} read     1 if message is read, 0 otherwise.
     * @param {number} [userId] User we want to delete the message for. If not defined, use current user.
     * @return {Promise<any>}   Promise resolved when the message has been deleted.
     */
    deleteMessageOnline(id: number, read: number, userId?: number): Promise<any> {
        userId = userId || this.sitesProvider.getCurrentSiteUserId();
        const params = {
            messageid: id,
            userid: userId,
            read: read
        };

        return this.sitesProvider.getCurrentSite().write('core_message_delete_message', params).then(() => {
            return this.invalidateDiscussionCache(userId);
        });
    }

    /**
     * Get the cache key for contacts.
     *
     * @return {string} Cache key.
     */
    protected getCacheKeyForContacts(): string {
        return this.ROOT_CACHE_KEY + 'contacts';
    }

    /**
     * Get the cache key for a discussion.
     *
     * @param {number} userId The other person with whom the current user is having the discussion.
     * @return {string} Cache key.
     */
    protected getCacheKeyForDiscussion(userId: number): string {
        return this.ROOT_CACHE_KEY + 'discussion:' + userId;
    }

    /**
     * Get the cache key for the list of discussions.
     *
     * @return {string} Cache key.
     */
    protected getCacheKeyForDiscussions(): string {
        return this.ROOT_CACHE_KEY + 'discussions';
    }

    /**
     * Return the current user's discussion with another user.
     *
     * @param  {number} userId               The ID of the other user.
     * @param  {boolean} excludePending      True to exclude messages pending to be sent.
     * @param  {number} [lfReceivedUnread=0] Number of unread received messages already fetched, so fetch will be done from this.
     * @param  {number} [lfReceivedRead=0]   Number of read received messages already fetched, so fetch will be done from this.
     * @param  {number} [lfSentUnread=0]     Number of unread sent messages already fetched, so fetch will be done from this.
     * @param  {number} [lfSentRead=0]       Number of read sent messages already fetched, so fetch will be done from this.
     * @param  {boolean} [toDisplay=true]    True if messages will be displayed to the user, either in view or in a notification.
     * @param  {string} [siteId]             Site ID. If not defined, use current site.
     * @return {Promise<any>}                     Promise resolved with messages and a boolean telling if can load more messages.
     */
    getDiscussion(userId: number, excludePending: boolean, lfReceivedUnread: number = 0, lfReceivedRead: number = 0,
            lfSentUnread: number = 0, lfSentRead: number = 0, toDisplay: boolean = true, siteId?: string): Promise<any> {

        return this.sitesProvider.getSite(siteId).then((site) => {
            const result = {},
                preSets = {
                    cacheKey: this.getCacheKeyForDiscussion(userId)
                },
                params = {
                    useridto: site.getUserId(),
                    useridfrom: userId,
                    limitnum: this.LIMIT_MESSAGES
                };

            let hasReceived,
                hasSent;

            if (lfReceivedUnread > 0 || lfReceivedRead > 0 || lfSentUnread > 0 || lfSentRead > 0) {
                // Do not use cache when retrieving older messages. This is to prevent storing too much data
                // and to prevent inconsistencies between "pages" loaded.
                preSets['getFromCache'] = 0;
                preSets['saveToCache'] = 0;
                preSets['emergencyCache'] = 0;
            }

            // Get message received by current user.
            return this.getRecentMessages(params, preSets, lfReceivedUnread, lfReceivedRead, toDisplay, site.getId())
                    .then((response) => {
                result['messages'] = response;
                params.useridto = userId;
                params.useridfrom = site.getUserId();
                hasReceived = response.length > 0;

                // Get message sent by current user.
                return this.getRecentMessages(params, preSets, lfSentUnread, lfSentRead, toDisplay, siteId);
            }).then((response) => {
                result['messages'] = result['messages'].concat(response);
                hasSent = response.length > 0;

                if (result['messages'].length > this.LIMIT_MESSAGES) {
                    // Sort messages and get the more recent ones.
                    result['canLoadMore'] = true;
                    result['messages'] = this.sortMessages(result['messages']);
                    result['messages'] = result['messages'].slice(-this.LIMIT_MESSAGES);
                } else {
                    result['canLoadMore'] = result['messages'].length == this.LIMIT_MESSAGES && (!hasReceived || !hasSent);
                }

                if (excludePending) {
                    // No need to get offline messages, return the ones we have.
                    return result;
                }

                // Get offline messages.
                return this.messagesOffline.getMessages(userId).then((offlineMessages) => {
                    // Mark offline messages as pending.
                    offlineMessages.forEach((message) => {
                        message.pending = true;
                        message.text = message.smallmessage;
                    });

                    result['messages'] = result['messages'].concat(offlineMessages);

                    return result;
                });
            });
        });
    }

    /**
     * Get the discussions of the current user.
     *
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Resolved with an object where the keys are the user ID of the other user.
     */
    getDiscussions(siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const discussions = {},
                currentUserId = site.getUserId(),
                params = {
                    useridto: currentUserId,
                    useridfrom: 0,
                    limitnum: this.LIMIT_MESSAGES
                },
                preSets = {
                    cacheKey: this.getCacheKeyForDiscussions()
                };

            /**
             * Convenience function to treat a recent message, adding it to discussions list if needed.
             */
            const treatRecentMessage = (message: any, userId: number, userFullname: string): void => {
                if (typeof discussions[userId] === 'undefined') {
                    discussions[userId] = {
                        fullname: userFullname,
                        profileimageurl: ''
                    };

                    if (!message.timeread && !message.pending && message.useridfrom != currentUserId) {
                        discussions[userId].unread = true;
                    }
                }

                // Extract the most recent message. Pending messages are considered more recent than messages already sent.
                const discMessage = discussions[userId].message;
                if (typeof discMessage === 'undefined' || (!discMessage.pending && message.pending) ||
                        (discMessage.pending == message.pending && (discMessage.timecreated < message.timecreated ||
                        (discMessage.timecreated == message.timecreated && discMessage.id < message.id)))) {

                    discussions[userId].message = {
                        id: message.id,
                        user: userId,
                        message: message.text,
                        timecreated: message.timecreated,
                        pending: !!message.pending
                    };
                }
            };

            // Get recent messages sent to current user.
            return this.getRecentMessages(params, preSets, undefined, undefined, undefined, site.getId()).then((messages) => {

                // Extract the discussions by filtering same senders.
                messages.forEach((message) => {
                    treatRecentMessage(message, message.useridfrom, message.userfromfullname);
                });

                // Now get the last messages sent by the current user.
                params.useridfrom = params.useridto;
                params.useridto = 0;

                return this.getRecentMessages(params, preSets);
            }).then((messages) => {

                // Extract the discussions by filtering same senders.
                messages.forEach((message) => {
                    treatRecentMessage(message, message.useridto, message.usertofullname);
                });

                // Now get unsent messages.
                return this.messagesOffline.getAllMessages(site.getId());
            }).then((offlineMessages) => {
                offlineMessages.forEach((message) => {
                    message.pending = true;
                    message.text = message.smallmessage;
                    treatRecentMessage(message, message.touserid, '');
                });

                return this.getDiscussionsUserImg(discussions, site.getId()).then((discussions) => {
                    this.storeUsersFromDiscussions(discussions);

                    return discussions;
                });
            });
        });
    }

    /**
     * Get user images for all the discussions that don't have one already.
     *
     * @param {any} discussions List of discussions.
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>}             Promise always resolved. Resolve param is the formatted discussions.
     */
    protected getDiscussionsUserImg(discussions: any, siteId?: string): Promise<any> {
        const promises = [];

        for (const userId in discussions) {
            if (!discussions[userId].profileimageurl) {
                // We don't have the user image. Try to retrieve it.
                promises.push(this.userProvider.getProfile(discussions[userId].message.user, 0, true, siteId).then((user) => {
                    discussions[userId].profileimageurl = user.profileimageurl;
                }).catch(() => {
                    // Error getting profile, resolve promise without adding any extra data.
                }));
            }
        }

        return Promise.all(promises).then(() => {
            return discussions;
        });
    }

    /**
     * Get messages according to the params.
     *
     * @param  {any} params            Parameters to pass to the WS.
     * @param  {any} preSets           Set of presets for the WS.
     * @param  {boolean} [toDisplay=true] True if messages will be displayed to the user, either in view or in a notification.
     * @param  {string} [siteId]          Site ID. If not defined, use current site.
     * @return {Promise<any>}
     */
    protected getMessages(params: any, preSets: any, toDisplay: boolean = true, siteId?: string): Promise<any> {
        params['type'] = 'conversations';
        params['newestfirst'] = 1;

        return this.sitesProvider.getSite(siteId).then((site) => {
            const userId = site.getUserId();

            return site.read('core_message_get_messages', params, preSets).then((response) => {
                response.messages.forEach((message) => {
                    message.read = params.read == 0 ? 0 : 1;
                    // Convert times to milliseconds.
                    message.timecreated = message.timecreated ? message.timecreated * 1000 : 0;
                    message.timeread = message.timeread ? message.timeread * 1000 : 0;
                });

                if (toDisplay && this.appProvider.isDesktop() && !params.read && params.useridto == userId &&
                        params.limitfrom === 0) {
                    // Store the last unread received messages. Don't block the user for this.
                    this.storeLastReceivedMessageIfNeeded(params.useridfrom, response.messages[0], site.getId());
                }

                return response;
            });
        });
    }

    /**
     * Get the most recent messages.
     *
     * @param  {any} params              Parameters to pass to the WS.
     * @param  {any} preSets             Set of presets for the WS.
     * @param  {number} [limitFromUnread=0] Number of read messages already fetched, so fetch will be done from this number.
     * @param  {number} [limitFromRead=0]   Number of unread messages already fetched, so fetch will be done from this number.
     * @param  {boolean} [toDisplay=true]   True if messages will be displayed to the user, either in view or in a notification.
     * @param  {string} [siteId]            Site ID. If not defined, use current site.
     * @return {Promise<any>}
     */
    protected getRecentMessages(params: any, preSets: any, limitFromUnread: number = 0, limitFromRead: number = 0,
            toDisplay: boolean = true, siteId?: string): Promise<any> {
        limitFromUnread = limitFromUnread || 0;
        limitFromRead = limitFromRead || 0;

        params['read'] = 0;
        params['limitfrom'] = limitFromUnread;

        return this.getMessages(params, preSets, toDisplay, siteId).then((response) => {
            let messages = response.messages;
            if (messages) {
                if (messages.length >= params.limitnum) {
                    return messages;
                }

                // We need to fetch more messages.
                params.limitnum = params.limitnum - messages.length;
                params.read = 1;
                params.limitfrom = limitFromRead;

                return this.getMessages(params, preSets, toDisplay, siteId).then((response) => {
                    if (response.messages) {
                        messages = messages.concat(response.messages);
                    }

                    return messages;
                }).catch(() => {
                    return messages;
                });

            } else {
                return Promise.reject(null);
            }
        });
    }

    /**
     * Invalidate contacts cache.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Resolved when done.
     */
    invalidateContactsCache(siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.invalidateWsCacheForKey(this.getCacheKeyForContacts());
        });
    }

    /**
     * Invalidate discussion cache.
     *
     * @param {number} userId    The user ID with whom the current user is having the discussion.
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Resolved when done.
     */
    invalidateDiscussionCache(userId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.invalidateWsCacheForKey(this.getCacheKeyForDiscussion(userId));
        });
    }

    /**
     * Invalidate discussions cache.
     *
     * Note that {@link this.getDiscussions} uses the contacts, so we need to invalidate contacts too.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Resolved when done.
     */
    invalidateDiscussionsCache(siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.invalidateWsCacheForKey(this.getCacheKeyForDiscussions()).then(() => {
                return this.invalidateContactsCache(site.getId());
            });
        });
    }

    /**
     * Returns whether or not we can mark all messages as read.
     *
     * @return {boolean} If related WS is avalaible on current site.
     * @since  3.2
     */
    isMarkAllMessagesReadEnabled(): boolean {
        return this.sitesProvider.getCurrentSite().wsAvailable('core_message_mark_all_messages_as_read');
    }

    /**
     * Returns whether or not the plugin is enabled in a certain site.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>}    Promise resolved with true if enabled, rejected or resolved with false otherwise.
     */
    isPluginEnabled(siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.canUseAdvancedFeature('messaging');
        });
    }

    /**
     * Returns whether or not we can search messages.
     *
     * @return {boolean}
     * @since  3.2
     */
    isSearchMessagesEnabled(): boolean {
        return this.sitesProvider.getCurrentSite().wsAvailable('core_message_data_for_messagearea_search_messages');
    }

    /**
     * Mark message as read.
     *
     * @param   {number}  messageId   ID of message to mark as read
     * @returns {Promise<any>} Promise resolved with boolean marking success or not.
     */
    markMessageRead(messageId: number): Promise<any> {
        const params = {
            messageid: messageId,
            timeread: this.timeUtils.timestamp()
        };

        return this.sitesProvider.getCurrentSite().write('core_message_mark_message_read', params);
    }

    /**
     * Mark all messages of a discussion as read.
     *
     * @param   {number}  userIdFrom  User Id for the sender.
     * @returns {Promise<any>} Promise resolved with boolean marking success or not.
     */
    markAllMessagesRead(userIdFrom?: number): Promise<any> {
        const params = {
                useridto: this.sitesProvider.getCurrentSiteUserId(),
                useridfrom: userIdFrom
            },
            preSets = {
                typeExpected: 'boolean'
            };

        return this.sitesProvider.getCurrentSite().write('core_message_mark_all_messages_as_read', params, preSets);
    }

    /**
     * Search for all the messges with a specific text.
     *
     * @param  {string} query        The query string
     * @param  {number} [userId]     The user ID. If not defined, current user.
     * @param  {number} [from=0]     Position of the first result to get. Defaults to 0.
     * @param  {number} [limit]      Number of results to get. Defaults to LIMIT_MESSAGES.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}              Promise resolved with the results.
     */
    searchMessages(query: string, userId?: number, from: number = 0, limit: number = this.LIMIT_MESSAGES, siteId?: string):
            Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const param = {
                    userid: userId || site.getUserId(),
                    search: query,
                    limitfrom: from,
                    limitnum: limit
                },
                preSets = {
                    getFromCache: false // Always try to get updated data. If it fails, it will get it from cache.
                };

            return site.read('core_message_data_for_messagearea_search_messages', param, preSets).then((searchResults) => {
                return searchResults.contacts;
            });
        });
    }

    /**
     * Send a message to someone.
     *
     * @param {number} userIdTo  User ID to send the message to.
     * @param {string} message   The message to send
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>}       Promise resolved with:
     *                                 - sent (Boolean) True if message was sent to server, false if stored in device.
     *                                 - message (Object) If sent=false, contains the stored message.
     */
    sendMessage(toUserId: number, message: string, siteId?: string): Promise<any> {
        // Convenience function to store a message to be synchronized later.
        const storeOffline = (): Promise<any> => {
            return this.messagesOffline.saveMessage(toUserId, message, siteId).then((entry) => {
                return {
                    sent: false,
                    message: entry
                };
            });
        };

        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        if (!this.appProvider.isOnline()) {
            // App is offline, store the message.
            return storeOffline();
        }

        // Check if this conversation already has offline messages.
        // If so, store this message since they need to be sent in order.
        return this.messagesOffline.hasMessages(toUserId, siteId).catch(() => {
            // Error, it's safer to assume it has messages.
            return true;
        }).then((hasStoredMessages) => {
            if (hasStoredMessages) {
                return storeOffline();
            }

            // Online and no messages stored. Send it to server.
            return this.sendMessageOnline(toUserId, message).then(() => {
                return { sent: true };
            }).catch((data) => {
                if (data.wserror) {
                    // It's a WebService error, the user cannot send the message so don't store it.
                    return Promise.reject(data.error);
                } else {
                    // Error sending message, store it to retry later.
                    return storeOffline();
                }
            });
        });
    }

    /**
     * Send a message to someone. It will fail if offline or cannot connect.
     *
     * @param {number} toUserId  User ID to send the message to.
     * @param {string} message   The message to send
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>}    Promise resolved if success, rejected if failure. Reject param is an object with:
     *                               - error: The error message.
     *                               - wserror: True if it's an error returned by the WebService, false otherwise.
     */
    sendMessageOnline(toUserId: number, message: string, siteId?: string): Promise<any> {
        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        const messages = [
                {
                    touserid: toUserId,
                    text: message,
                    textformat: 1
                }
            ];

        return this.sendMessagesOnline(messages, siteId).catch((error) => {
            return Promise.reject({
                error: error,
                wserror: this.utils.isWebServiceError(error)
            });
        }).then((response) => {
            if (response && response[0] && response[0].msgid === -1) {
                // There was an error, and it should be translated already.
                return Promise.reject({
                    error: response[0].errormessage,
                    wserror: true
                });
            }

            return this.invalidateDiscussionCache(toUserId, siteId).catch(() => {
                // Ignore errors.
            });
        });
    }

    /**
     * Send some messages. It will fail if offline or cannot connect.
     * IMPORTANT: Sending several messages at once for the same discussions can cause problems with display order,
     * since messages with same timecreated aren't ordered by ID.
     *
     * @param  {any} messages Messages to send. Each message must contain touserid, text and textformat.
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>}    Promise resolved if success, rejected if failure. Promise resolved doesn't mean that messages
     *                           have been sent, the resolve param can contain errors for messages not sent.
     */
    sendMessagesOnline(messages: any, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const data = {
                messages: messages
            };

            return site.write('core_message_send_instant_messages', data);
        });
    }

    /**
     * Helper method to sort messages by time.
     *
     * @param {any} messages Array of messages containing the key 'timecreated'.
     * @return {any} Messages sorted with most recent last.
     */
    sortMessages(messages: any): any {
        return messages.sort((a, b) => {
            // Pending messages last.
            if (a.pending && !b.pending) {
                return 1;
            } else if (!a.pending && b.pending) {
                return -1;
            }

            const timecreatedA = parseInt(a.timecreated, 10),
                timecreatedB = parseInt(b.timecreated, 10);
            if (timecreatedA == timecreatedB && a.id) {
                // Same time, sort by ID.
                return a.id >= b.id ? 1 : -1;
            }

            return timecreatedA >= timecreatedB ? 1 : -1;
        });
    }

    /**
     * Store the last received message if it's newer than the last stored.
     * @todo
     *
     * @param  {number} userIdFrom ID of the useridfrom retrieved, 0 for all users.
     * @param  {any} message       Last message received.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<any>}      Promise resolved when done.
     */
    protected storeLastReceivedMessageIfNeeded(userIdFrom: number, message: any, siteId?: string): Promise<any> {
        /*let component = mmaMessagesPushSimulationComponent;

        // Get the last received message.
        return $mmEmulatorHelper.getLastReceivedNotification(component, siteId).then((lastMessage) => {
            if (userIdFrom > 0 && (!message || !lastMessage)) {
                // Seeing a single discussion. No received message or cannot know if it really is the last received message. Stop.
                return;
            }

            if (message && lastMessage && message.timecreated <= lastMessage.timecreated) {
                // The message isn't newer than the stored message, don't store it.
                return;
            }

            return $mmEmulatorHelper.storeLastReceivedNotification(component, message, siteId);
        });*/
        return Promise.resolve();
    }

    /**
     * Store user data from discussions in local DB.
     *
     * @param {any} discussions List of discussions.
     * @param {string} [siteId] Site ID. If not defined, current site.
     */
    protected storeUsersFromDiscussions(discussions: any, siteId?: string): void {
        const users = [];
        for (const userId in discussions) {
            if (typeof userId != 'undefined' && !isNaN(parseInt(userId))) {
                users.push({
                    id: userId,
                    fullname: discussions[userId].fullname,
                    profileimageurl: discussions[userId].profileimageurl
                });
            }
        }
        this.userProvider.storeUsers(users, siteId);
    }
}
