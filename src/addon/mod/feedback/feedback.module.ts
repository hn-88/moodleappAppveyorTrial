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

import { NgModule } from '@angular/core';
import { CoreCronDelegate } from '@providers/cron';
import { CoreContentLinksDelegate } from '@core/contentlinks/providers/delegate';
import { CoreCourseModuleDelegate } from '@core/course/providers/module-delegate';
import { CoreCourseModulePrefetchDelegate } from '@core/course/providers/module-prefetch-delegate';
import { AddonModFeedbackComponentsModule } from './components/components.module';
import { AddonModFeedbackModuleHandler } from './providers/module-handler';
import { AddonModFeedbackProvider } from './providers/feedback';
import { AddonModFeedbackLinkHandler } from './providers/link-handler';
import { AddonModFeedbackHelperProvider } from './providers/helper';
import { AddonModFeedbackPrefetchHandler } from './providers/prefetch-handler';
import { AddonModFeedbackSyncProvider } from './providers/sync';
import { AddonModFeedbackSyncCronHandler } from './providers/sync-cron-handler';
import { AddonModFeedbackOfflineProvider } from './providers/offline';

@NgModule({
    declarations: [
    ],
    imports: [
        AddonModFeedbackComponentsModule
    ],
    providers: [
        AddonModFeedbackProvider,
        AddonModFeedbackModuleHandler,
        AddonModFeedbackPrefetchHandler,
        AddonModFeedbackHelperProvider,
        AddonModFeedbackLinkHandler,
        AddonModFeedbackSyncCronHandler,
        AddonModFeedbackSyncProvider,
        AddonModFeedbackOfflineProvider
    ]
})
export class AddonModFeedbackModule {
    constructor(moduleDelegate: CoreCourseModuleDelegate, moduleHandler: AddonModFeedbackModuleHandler,
            prefetchDelegate: CoreCourseModulePrefetchDelegate, prefetchHandler: AddonModFeedbackPrefetchHandler,
            contentLinksDelegate: CoreContentLinksDelegate, linkHandler: AddonModFeedbackLinkHandler,
            cronDelegate: CoreCronDelegate, syncHandler: AddonModFeedbackSyncCronHandler) {
        moduleDelegate.registerHandler(moduleHandler);
        prefetchDelegate.registerHandler(prefetchHandler);
        contentLinksDelegate.registerHandler(linkHandler);
        cronDelegate.register(syncHandler);
    }
}
