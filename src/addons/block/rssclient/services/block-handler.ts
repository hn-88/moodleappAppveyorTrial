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

import { CoreBlockHandlerData } from '@features/block/services/block-delegate';
import { CoreBlockBaseHandler } from '@features/block/classes/base-block-handler';
import { CoreCourseBlock } from '@features/course/services/course';
import { AddonBlockRssClientComponent } from '../components/rssclient/rssclient';
import { makeSingleton } from '@singletons';

/**
 * Block handler.
 */
@Injectable({ providedIn: 'root' })
export class AddonBlockRssClientHandlerService extends CoreBlockBaseHandler {

    name = 'AddonBlockRssClient';
    blockName = 'rss_client';

    /**
     * Returns the data needed to render the block.
     *
     * @param block The block to render.
     * @return Data or promise resolved with the data.
     */
    getDisplayData(block: CoreCourseBlock): CoreBlockHandlerData {

        return {
            title: block.contents?.title || 'addon.block_rssclient.pluginname',
            class: 'addon-block-rss-client',
            component: AddonBlockRssClientComponent,
        };
    }

}

export class AddonBlockRssClientHandler extends makeSingleton(AddonBlockRssClientHandlerService) {}
