// @ts-nocheck
export function iter(o, fn) {
    if (isArray(o)) {
        for (let i = 0; i < o.length; i++) fn(i, o[i])
    } else {
        for (const i in o) fn(i, o[i])
    }
}

export const { isArray } = Array

export const identity = d => d

export const noop = () => { }

export const U = undefined