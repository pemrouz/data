declare function h(tag: any, props: any, ...children: any[]): any;
declare function Fragment(_: any, ...children: any[]): any;
declare function _jsx(type: any, props: any, _key?: any): any;
declare const jsx: typeof _jsx;
declare const jsxs: typeof _jsx;
declare const jsxDEV: typeof _jsx;
declare function For({ each, tag }: {
    each: any;
    tag?: string;
    children?: any;
}, fn: (item: any, key: any) => any): any;

export { For as F, Fragment as a, jsxDEV as b, jsxs as c, h, jsx as j };
