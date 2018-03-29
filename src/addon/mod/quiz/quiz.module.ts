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
import { CoreCourseModuleDelegate } from '@core/course/providers/module-delegate';
import { CoreCourseModulePrefetchDelegate } from '@core/course/providers/module-prefetch-delegate';
import { AddonModQuizAccessRuleDelegate } from './providers/access-rules-delegate';
import { AddonModQuizProvider } from './providers/quiz';
import { AddonModQuizOfflineProvider } from './providers/quiz-offline';
import { AddonModQuizHelperProvider } from './providers/helper';
import { AddonModQuizSyncProvider } from './providers/quiz-sync';
import { AddonModQuizModuleHandler } from './providers/module-handler';
import { AddonModQuizPrefetchHandler } from './providers/prefetch-handler';
import { AddonModQuizSyncCronHandler } from './providers/sync-cron-handler';
import { AddonModQuizComponentsModule } from './components/components.module';

// Access rules.
import { AddonModQuizAccessDelayBetweenAttemptsModule } from './accessrules/delaybetweenattempts/delaybetweenattempts.module';
import { AddonModQuizAccessIpAddressModule } from './accessrules/ipaddress/ipaddress.module';
import { AddonModQuizAccessNumAttemptsModule } from './accessrules/numattempts/numattempts.module';
import { AddonModQuizAccessOfflineAttemptsModule } from './accessrules/offlineattempts/offlineattempts.module';
import { AddonModQuizAccessOpenCloseDateModule } from './accessrules/openclosedate/openclosedate.module';
import { AddonModQuizAccessPasswordModule } from './accessrules/password/password.module';
import { AddonModQuizAccessSafeBrowserModule } from './accessrules/safebrowser/safebrowser.module';
import { AddonModQuizAccessSecureWindowModule } from './accessrules/securewindow/securewindow.module';
import { AddonModQuizAccessTimeLimitModule } from './accessrules/timelimit/timelimit.module';

@NgModule({
    declarations: [
    ],
    imports: [
        AddonModQuizComponentsModule,
        AddonModQuizAccessDelayBetweenAttemptsModule,
        AddonModQuizAccessIpAddressModule,
        AddonModQuizAccessNumAttemptsModule,
        AddonModQuizAccessOfflineAttemptsModule,
        AddonModQuizAccessOpenCloseDateModule,
        AddonModQuizAccessPasswordModule,
        AddonModQuizAccessSafeBrowserModule,
        AddonModQuizAccessSecureWindowModule,
        AddonModQuizAccessTimeLimitModule
    ],
    providers: [
        AddonModQuizAccessRuleDelegate,
        AddonModQuizProvider,
        AddonModQuizOfflineProvider,
        AddonModQuizHelperProvider,
        AddonModQuizSyncProvider,
        AddonModQuizModuleHandler,
        AddonModQuizPrefetchHandler,
        AddonModQuizSyncCronHandler
    ]
})
export class AddonModQuizModule {
    constructor(moduleDelegate: CoreCourseModuleDelegate, moduleHandler: AddonModQuizModuleHandler,
            prefetchDelegate: CoreCourseModulePrefetchDelegate, prefetchHandler: AddonModQuizPrefetchHandler,
            cronDelegate: CoreCronDelegate, syncHandler: AddonModQuizSyncCronHandler) {

        moduleDelegate.registerHandler(moduleHandler);
        prefetchDelegate.registerHandler(prefetchHandler);
        cronDelegate.register(syncHandler);
    }
}
