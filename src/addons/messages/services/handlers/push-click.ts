// (C) Copyright 2015 Moodle Pty Ltd.
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
import { Params } from '@angular/router';
import { CorePushNotificationsClickHandler } from '@features/pushnotifications/services/push-delegate';
import { CorePushNotificationsNotificationBasicData } from '@features/pushnotifications/services/pushnotifications';
import { CoreNavigator } from '@services/navigator';
import { CoreUtils } from '@services/utils/utils';
import { makeSingleton } from '@singletons';
import { AddonMessages } from '../messages';

/**
 * Handler for messaging push notifications clicks.
 */
@Injectable({ providedIn: 'root' })
export class AddonMessagesPushClickHandlerService implements CorePushNotificationsClickHandler {

    name = 'AddonMessagesPushClickHandler';
    priority = 200;
    featureName = 'CoreMainMenuDelegate_AddonMessages';

    /**
     * Check if a notification click is handled by this handler.
     *
     * @param notification The notification to check.
     * @return Whether the notification click is handled by this handler
     */
    async handles(notification: AddonMessagesPushNotificationData): Promise<boolean> {
        if (CoreUtils.instance.isTrueOrOne(notification.notif) && notification.name != 'messagecontactrequests') {
            return false;
        }

        // Check that messaging is enabled.
        return AddonMessages.instance.isPluginEnabled(notification.site);
    }

    /**
     * Handle the notification click.
     *
     * @param notification The notification to check.
     * @return Promise resolved when done.
     */
    async handleClick(notification: AddonMessagesPushNotificationData): Promise<void> {
        try {
            await AddonMessages.instance.invalidateDiscussionsCache(notification.site);
        } catch {
            // Ignore errors.
        }

        // Check if group messaging is enabled, to determine which page should be loaded.
        const enabled = await AddonMessages.instance.isGroupMessagingEnabledInSite(notification.site);
        const pageName = await AddonMessages.instance.getMainMessagesPagePathInSite(notification.site);

        const pageParams: Params = {};

        // Check if we have enough information to open the conversation.
        if (notification.convid && enabled) {
            pageParams.conversationId = Number(notification.convid);
        } else if (notification.userfromid) {
            pageParams.discussionUserId = Number(notification.userfromid);
        }

        await CoreNavigator.instance.navigateToSitePath(pageName, { params: pageParams, siteId: notification.site });
    }

}

export class AddonMessagesPushClickHandler extends makeSingleton(AddonMessagesPushClickHandlerService) {}

type AddonMessagesPushNotificationData = CorePushNotificationsNotificationBasicData & {
    convid?: number; // Conversation Id.
};
