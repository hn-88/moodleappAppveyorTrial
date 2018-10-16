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

import { Component, Input, OnInit, Injector } from '@angular/core';
import { CoreBlockDelegate } from '../../providers/delegate';

/**
 * Component to render a block.
 */
@Component({
    selector: 'core-block',
    templateUrl: 'core-block.html'
})
export class CoreBlockComponent implements OnInit {
    @Input() block: any; // The block to render.
    @Input() contextLevel: string; // The context where the block will be used.
    @Input() instanceId: number; // The instance ID associated with the context level.
    @Input() extraData: any; // Any extra data to be passed to the block.

    title: string; // The title of the block.
    componentClass: any; // The class of the component to render.
    data: any = {}; // Data to pass to the component.
    class: string; // CSS class to apply to the block.
    loaded = false;

    constructor(protected injector: Injector, protected blockDelegate: CoreBlockDelegate) { }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        if (!this.block) {
            this.loaded = true;

            return;
        }

        // Get the data to render the block.
        this.blockDelegate.getBlockDisplayData(this.injector, this.block, this.contextLevel, this.instanceId).then((data) => {
            if (!data) {
                // Block not supported, don't render it.
                return;
            }

            this.title = data.title;
            this.class = data.class;
            this.componentClass = data.component;

            // Set up the data needed by the block component.
            this.data = Object.assign({
                    block: this.block,
                    contextLevel: this.contextLevel,
                    instanceId: this.instanceId,
                }, this.extraData || {}, data.componentData || {});
        }).catch(() => {
            // Ignore errors.
        }).finally(() => {
            this.loaded = true;
        });
    }
}
