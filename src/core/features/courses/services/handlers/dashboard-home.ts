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
import { CoreMainMenuHomeHandler, CoreMainMenuHomeHandlerToDisplay } from '@features/mainmenu/services/home-delegate';
import { makeSingleton } from '@singletons';

/**
 * Handler to add dashboard into home page.
 */
@Injectable({ providedIn: 'root' })
export class CoreDashboardHomeHandlerService implements CoreMainMenuHomeHandler {

    static readonly PAGE_NAME = 'dashboard';

    name = 'CoreCoursesDashboard';
    priority = 1100;

    /**
     * Check if the handler is enabled on a site level.
     *
     * @return Whether or not the handler is enabled on a site level.
     */
    isEnabled(): Promise<boolean> {
        return this.isEnabledForSite();
    }

    /**
     * Check if the handler is enabled on a certain site.
     *
     * @param siteId Site ID. If not defined, current site.
     * @return Whether or not the handler is enabled on a site level.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async isEnabledForSite(siteId?: string): Promise<boolean> {
        // @todo return this.blockDelegate.hasSupportedBlock(this.blocks);
        return true;
    }

    /**
     * Returns the data needed to render the handler.
     *
     * @return Data needed to render the handler.
     */
    getDisplayData(): CoreMainMenuHomeHandlerToDisplay {
        return {
            title: 'core.courses.mymoodle',
            page: CoreDashboardHomeHandlerService.PAGE_NAME,
            class: 'core-courses-dashboard-handler',
            icon: 'fas-tachometer-alt',
            selectPriority: 1000,
        };
    }

}

export class CoreDashboardHomeHandler extends makeSingleton(CoreDashboardHomeHandlerService) {}
