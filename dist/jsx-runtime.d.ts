export { a as Fragment, j as jsx, c as jsxs } from './index-PXzllCJG.js';

declare namespace JSX {
    type AnyVP = ((...a: any[]) => any) & {
        [k: string | symbol]: any;
    };
    type Reactive<T> = T | AnyVP;
    export type Element = any;
    export interface ElementChildrenAttribute {
        children: {};
    }
    export interface IntrinsicAttributes {
        key?: string | number;
    }
    export interface DOMProps {
        ref?: (el: any) => void;
        key?: string | number;
        children?: any;
        className?: Reactive<string>;
        class?: Reactive<string> | {
            [name: string]: Reactive<boolean>;
        };
        style?: {
            [prop: string]: Reactive<string | number>;
        };
        id?: Reactive<string>;
        [attr: string]: any;
    }
    export interface IntrinsicElements {
        [tag: string]: DOMProps;
    }
    export {  };
}

export { JSX };
