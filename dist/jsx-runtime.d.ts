export { a as Fragment, j as jsx, c as jsxs } from './index-B3iJB87-.js';
import './core-B6UvChJ_.js';

type AnyVP = ((...a: any[]) => any) & {
    [k: string | symbol]: any;
};
type Reactive<T> = T | AnyVP;
type EventHandler<E = any> = (event: E) => void;
interface DOMAttributes {
    ref?: (el: any) => void;
    key?: string | number;
    className?: Reactive<string>;
    class?: Reactive<string> | {
        [name: string]: Reactive<boolean>;
    };
    style?: {
        [k: string]: Reactive<string | number>;
    };
    id?: Reactive<string>;
    onClick?: EventHandler;
    onDblClick?: EventHandler;
    onChange?: EventHandler;
    onInput?: EventHandler;
    onBlur?: EventHandler;
    onFocus?: EventHandler;
    onKeyDown?: EventHandler;
    onKeyUp?: EventHandler;
    onKeyPress?: EventHandler;
    onMouseDown?: EventHandler;
    onMouseUp?: EventHandler;
    onMouseMove?: EventHandler;
    onMouseEnter?: EventHandler;
    onMouseLeave?: EventHandler;
    onMouseOver?: EventHandler;
    onMouseOut?: EventHandler;
    onPointerDown?: EventHandler;
    onPointerUp?: EventHandler;
    onPointerMove?: EventHandler;
    onPointerEnter?: EventHandler;
    onPointerLeave?: EventHandler;
    onPointerCancel?: EventHandler;
    onPointerOver?: EventHandler;
    onPointerOut?: EventHandler;
    onSubmit?: EventHandler;
    onScroll?: EventHandler;
    onWheel?: EventHandler;
    onContextMenu?: EventHandler;
    onDrag?: EventHandler;
    onDragEnd?: EventHandler;
    onDragEnter?: EventHandler;
    onDragLeave?: EventHandler;
    onDragOver?: EventHandler;
    onDragStart?: EventHandler;
    onDrop?: EventHandler;
    onTouchStart?: EventHandler;
    onTouchMove?: EventHandler;
    onTouchEnd?: EventHandler;
    onTouchCancel?: EventHandler;
    onLoad?: EventHandler;
    onError?: EventHandler;
    children?: any;
    [k: string]: any;
}
interface AriaAttributes {
    'aria-label'?: Reactive<string>;
    'aria-labelledby'?: Reactive<string>;
    'aria-describedby'?: Reactive<string>;
    'aria-hidden'?: Reactive<boolean | 'true' | 'false'>;
    'aria-live'?: Reactive<'off' | 'polite' | 'assertive'>;
    'aria-checked'?: Reactive<boolean | 'true' | 'false' | 'mixed'>;
    'aria-disabled'?: Reactive<boolean | 'true' | 'false'>;
    'aria-expanded'?: Reactive<boolean | 'true' | 'false'>;
    'aria-selected'?: Reactive<boolean | 'true' | 'false'>;
    'aria-pressed'?: Reactive<boolean | 'true' | 'false' | 'mixed'>;
    'aria-current'?: Reactive<boolean | 'page' | 'step' | 'location' | 'date' | 'time'>;
    'aria-controls'?: Reactive<string>;
    'aria-haspopup'?: Reactive<boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'>;
    role?: Reactive<string>;
}
interface HTMLAttributes extends DOMAttributes, AriaAttributes {
    accesskey?: Reactive<string>;
    autofocus?: Reactive<boolean | ''>;
    contenteditable?: Reactive<boolean | 'true' | 'false' | 'inherit'>;
    contextmenu?: Reactive<string>;
    dir?: Reactive<'ltr' | 'rtl' | 'auto'>;
    draggable?: Reactive<boolean | 'true' | 'false'>;
    hidden?: Reactive<boolean>;
    lang?: Reactive<string>;
    slot?: Reactive<string>;
    spellcheck?: Reactive<boolean | 'true' | 'false'>;
    tabindex?: Reactive<number | string>;
    title?: Reactive<string>;
    translate?: Reactive<'yes' | 'no'>;
    tabIndex?: Reactive<number | string>;
    for?: Reactive<string>;
    htmlFor?: Reactive<string>;
}
interface AnchorHTMLAttributes extends HTMLAttributes {
    href?: Reactive<string>;
    target?: Reactive<'_self' | '_blank' | '_parent' | '_top' | string>;
    rel?: Reactive<string>;
    download?: Reactive<string | boolean>;
    hreflang?: Reactive<string>;
    type?: Reactive<string>;
    referrerpolicy?: Reactive<string>;
}
interface ButtonHTMLAttributes extends HTMLAttributes {
    type?: Reactive<'button' | 'submit' | 'reset'>;
    disabled?: Reactive<boolean>;
    form?: Reactive<string>;
    formaction?: Reactive<string>;
    formmethod?: Reactive<string>;
    formnovalidate?: Reactive<boolean>;
    formtarget?: Reactive<string>;
    name?: Reactive<string>;
    value?: Reactive<string | number>;
}
interface InputHTMLAttributes extends HTMLAttributes {
    type?: Reactive<'button' | 'checkbox' | 'color' | 'date' | 'datetime-local' | 'email' | 'file' | 'hidden' | 'image' | 'month' | 'number' | 'password' | 'radio' | 'range' | 'reset' | 'search' | 'submit' | 'tel' | 'text' | 'time' | 'url' | 'week'>;
    accept?: Reactive<string>;
    alt?: Reactive<string>;
    autocomplete?: Reactive<string>;
    capture?: Reactive<boolean | 'user' | 'environment'>;
    checked?: Reactive<boolean>;
    defaultChecked?: Reactive<boolean>;
    defaultValue?: Reactive<string | number>;
    disabled?: Reactive<boolean>;
    form?: Reactive<string>;
    list?: Reactive<string>;
    max?: Reactive<number | string>;
    maxlength?: Reactive<number>;
    min?: Reactive<number | string>;
    minlength?: Reactive<number>;
    multiple?: Reactive<boolean>;
    name?: Reactive<string>;
    pattern?: Reactive<string>;
    placeholder?: Reactive<string>;
    readonly?: Reactive<boolean>;
    required?: Reactive<boolean>;
    size?: Reactive<number>;
    src?: Reactive<string>;
    step?: Reactive<number | string>;
    value?: Reactive<string | number>;
}
interface TextareaHTMLAttributes extends HTMLAttributes {
    autocomplete?: Reactive<string>;
    cols?: Reactive<number>;
    dirname?: Reactive<string>;
    disabled?: Reactive<boolean>;
    form?: Reactive<string>;
    maxlength?: Reactive<number>;
    minlength?: Reactive<number>;
    name?: Reactive<string>;
    placeholder?: Reactive<string>;
    readonly?: Reactive<boolean>;
    required?: Reactive<boolean>;
    rows?: Reactive<number>;
    value?: Reactive<string>;
    wrap?: Reactive<'soft' | 'hard'>;
}
interface SelectHTMLAttributes extends HTMLAttributes {
    autocomplete?: Reactive<string>;
    disabled?: Reactive<boolean>;
    form?: Reactive<string>;
    multiple?: Reactive<boolean>;
    name?: Reactive<string>;
    required?: Reactive<boolean>;
    size?: Reactive<number>;
    value?: Reactive<string | number>;
}
interface OptionHTMLAttributes extends HTMLAttributes {
    disabled?: Reactive<boolean>;
    label?: Reactive<string>;
    selected?: Reactive<boolean>;
    value?: Reactive<string | number>;
}
interface FormHTMLAttributes extends HTMLAttributes {
    action?: Reactive<string>;
    method?: Reactive<'get' | 'post' | 'dialog'>;
    enctype?: Reactive<string>;
    acceptCharset?: Reactive<string>;
    autocomplete?: Reactive<string>;
    name?: Reactive<string>;
    novalidate?: Reactive<boolean>;
    target?: Reactive<string>;
}
interface ImgHTMLAttributes extends HTMLAttributes {
    alt?: Reactive<string>;
    crossorigin?: Reactive<'anonymous' | 'use-credentials' | ''>;
    decoding?: Reactive<'async' | 'auto' | 'sync'>;
    height?: Reactive<number | string>;
    loading?: Reactive<'eager' | 'lazy'>;
    referrerpolicy?: Reactive<string>;
    sizes?: Reactive<string>;
    src?: Reactive<string>;
    srcset?: Reactive<string>;
    usemap?: Reactive<string>;
    width?: Reactive<number | string>;
}
interface LabelHTMLAttributes extends HTMLAttributes {
    for?: Reactive<string>;
    htmlFor?: Reactive<string>;
    form?: Reactive<string>;
}
interface MetaHTMLAttributes extends HTMLAttributes {
    charset?: Reactive<string>;
    content?: Reactive<string>;
    httpEquiv?: Reactive<string>;
    name?: Reactive<string>;
}
interface ScriptHTMLAttributes extends HTMLAttributes {
    async?: Reactive<boolean>;
    crossorigin?: Reactive<string>;
    defer?: Reactive<boolean>;
    integrity?: Reactive<string>;
    nomodule?: Reactive<boolean>;
    nonce?: Reactive<string>;
    referrerpolicy?: Reactive<string>;
    src?: Reactive<string>;
    type?: Reactive<string>;
}
interface IframeHTMLAttributes extends HTMLAttributes {
    allow?: Reactive<string>;
    allowfullscreen?: Reactive<boolean>;
    height?: Reactive<number | string>;
    loading?: Reactive<'eager' | 'lazy'>;
    name?: Reactive<string>;
    referrerpolicy?: Reactive<string>;
    sandbox?: Reactive<string>;
    src?: Reactive<string>;
    srcdoc?: Reactive<string>;
    width?: Reactive<number | string>;
}
interface VideoHTMLAttributes extends HTMLAttributes {
    autoplay?: Reactive<boolean>;
    controls?: Reactive<boolean>;
    crossorigin?: Reactive<string>;
    height?: Reactive<number | string>;
    loop?: Reactive<boolean>;
    muted?: Reactive<boolean>;
    playsinline?: Reactive<boolean>;
    poster?: Reactive<string>;
    preload?: Reactive<'none' | 'metadata' | 'auto'>;
    src?: Reactive<string>;
    width?: Reactive<number | string>;
}
interface AudioHTMLAttributes extends HTMLAttributes {
    autoplay?: Reactive<boolean>;
    controls?: Reactive<boolean>;
    crossorigin?: Reactive<string>;
    loop?: Reactive<boolean>;
    muted?: Reactive<boolean>;
    preload?: Reactive<'none' | 'metadata' | 'auto'>;
    src?: Reactive<string>;
}
interface CanvasHTMLAttributes extends HTMLAttributes {
    height?: Reactive<number | string>;
    width?: Reactive<number | string>;
}
interface SVGAttributes extends DOMAttributes, AriaAttributes {
    x?: Reactive<number | string>;
    y?: Reactive<number | string>;
    x1?: Reactive<number | string>;
    y1?: Reactive<number | string>;
    x2?: Reactive<number | string>;
    y2?: Reactive<number | string>;
    cx?: Reactive<number | string>;
    cy?: Reactive<number | string>;
    r?: Reactive<number | string>;
    rx?: Reactive<number | string>;
    ry?: Reactive<number | string>;
    width?: Reactive<number | string>;
    height?: Reactive<number | string>;
    d?: Reactive<string>;
    points?: Reactive<string>;
    fill?: Reactive<string>;
    stroke?: Reactive<string>;
    'stroke-width'?: Reactive<number | string>;
    'stroke-linecap'?: Reactive<'butt' | 'round' | 'square'>;
    'stroke-linejoin'?: Reactive<'miter' | 'round' | 'bevel'>;
    'stroke-dasharray'?: Reactive<string>;
    'stroke-dashoffset'?: Reactive<number | string>;
    opacity?: Reactive<number | string>;
    'fill-opacity'?: Reactive<number | string>;
    'stroke-opacity'?: Reactive<number | string>;
    transform?: Reactive<string>;
    'clip-path'?: Reactive<string>;
    'text-anchor'?: Reactive<'start' | 'middle' | 'end'>;
    dy?: Reactive<number | string>;
    dx?: Reactive<number | string>;
    viewBox?: Reactive<string>;
    preserveAspectRatio?: Reactive<string>;
    xmlns?: Reactive<string>;
    href?: Reactive<string>;
    'xlink:href'?: Reactive<string>;
    offset?: Reactive<number | string>;
    'stop-color'?: Reactive<string>;
    'stop-opacity'?: Reactive<string>;
}
type Element = any;
interface ElementChildrenAttribute {
    children: {};
}
interface IntrinsicAttributes {
    key?: string | number;
}
interface IntrinsicElements {
    html: HTMLAttributes;
    head: HTMLAttributes;
    body: HTMLAttributes;
    title: HTMLAttributes;
    section: HTMLAttributes;
    header: HTMLAttributes;
    footer: HTMLAttributes;
    main: HTMLAttributes;
    nav: HTMLAttributes;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    hgroup: HTMLAttributes;
    address: HTMLAttributes;
    div: HTMLAttributes;
    p: HTMLAttributes;
    hr: HTMLAttributes;
    pre: HTMLAttributes;
    blockquote: HTMLAttributes;
    ol: HTMLAttributes;
    ul: HTMLAttributes;
    li: HTMLAttributes;
    dl: HTMLAttributes;
    dt: HTMLAttributes;
    dd: HTMLAttributes;
    figure: HTMLAttributes;
    figcaption: HTMLAttributes;
    a: AnchorHTMLAttributes;
    em: HTMLAttributes;
    strong: HTMLAttributes;
    small: HTMLAttributes;
    s: HTMLAttributes;
    cite: HTMLAttributes;
    q: HTMLAttributes;
    dfn: HTMLAttributes;
    abbr: HTMLAttributes;
    time: HTMLAttributes;
    code: HTMLAttributes;
    var: HTMLAttributes;
    samp: HTMLAttributes;
    kbd: HTMLAttributes;
    sub: HTMLAttributes;
    sup: HTMLAttributes;
    i: HTMLAttributes;
    b: HTMLAttributes;
    u: HTMLAttributes;
    mark: HTMLAttributes;
    ruby: HTMLAttributes;
    rt: HTMLAttributes;
    rp: HTMLAttributes;
    bdi: HTMLAttributes;
    bdo: HTMLAttributes;
    span: HTMLAttributes;
    br: HTMLAttributes;
    wbr: HTMLAttributes;
    img: ImgHTMLAttributes;
    iframe: IframeHTMLAttributes;
    embed: HTMLAttributes;
    object: HTMLAttributes;
    param: HTMLAttributes;
    video: VideoHTMLAttributes;
    audio: AudioHTMLAttributes;
    source: HTMLAttributes;
    track: HTMLAttributes;
    map: HTMLAttributes;
    area: HTMLAttributes;
    picture: HTMLAttributes;
    canvas: CanvasHTMLAttributes;
    table: HTMLAttributes;
    caption: HTMLAttributes;
    colgroup: HTMLAttributes;
    col: HTMLAttributes;
    tbody: HTMLAttributes;
    thead: HTMLAttributes;
    tfoot: HTMLAttributes;
    tr: HTMLAttributes;
    td: HTMLAttributes;
    th: HTMLAttributes;
    form: FormHTMLAttributes;
    label: LabelHTMLAttributes;
    input: InputHTMLAttributes;
    button: ButtonHTMLAttributes;
    select: SelectHTMLAttributes;
    datalist: HTMLAttributes;
    optgroup: HTMLAttributes;
    option: OptionHTMLAttributes;
    textarea: TextareaHTMLAttributes;
    output: HTMLAttributes;
    progress: HTMLAttributes;
    meter: HTMLAttributes;
    fieldset: HTMLAttributes;
    legend: HTMLAttributes;
    details: HTMLAttributes;
    summary: HTMLAttributes;
    dialog: HTMLAttributes;
    menu: HTMLAttributes;
    script: ScriptHTMLAttributes;
    noscript: HTMLAttributes;
    template: HTMLAttributes;
    slot: HTMLAttributes;
    style: HTMLAttributes;
    link: HTMLAttributes;
    meta: MetaHTMLAttributes;
    base: HTMLAttributes;
    svg: SVGAttributes;
    g: SVGAttributes;
    path: SVGAttributes;
    rect: SVGAttributes;
    circle: SVGAttributes;
    ellipse: SVGAttributes;
    line: SVGAttributes;
    polyline: SVGAttributes;
    polygon: SVGAttributes;
    text: SVGAttributes;
    tspan: SVGAttributes;
    textPath: SVGAttributes;
    defs: SVGAttributes;
    clipPath: SVGAttributes;
    mask: SVGAttributes;
    pattern: SVGAttributes;
    image: SVGAttributes;
    use: SVGAttributes;
    symbol: SVGAttributes;
    marker: SVGAttributes;
    linearGradient: SVGAttributes;
    radialGradient: SVGAttributes;
    stop: SVGAttributes;
    foreignObject: SVGAttributes;
    filter: SVGAttributes;
    feGaussianBlur: SVGAttributes;
    feOffset: SVGAttributes;
    feMerge: SVGAttributes;
    feMergeNode: SVGAttributes;
    feColorMatrix: SVGAttributes;
    feFlood: SVGAttributes;
    feComposite: SVGAttributes;
    desc: SVGAttributes;
    [tag: string]: any;
}

declare namespace JSX {
    type Element = Element;
    type IntrinsicElements = IntrinsicElements;
    type ElementChildrenAttribute = ElementChildrenAttribute;
    type IntrinsicAttributes = IntrinsicAttributes;
}

export { JSX };
