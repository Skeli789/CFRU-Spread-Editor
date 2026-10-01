// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// Full editor renders are slow in jsdom, so findBy queries wait longer than the default second
configure({ asyncUtilTimeout: 5000 });

// dnd-kit constructs this observer as its module loads; jsdom does not implement it.
globalThis.ResizeObserver = class ResizeObserver
{
	observe() {}
	unobserve() {}
	disconnect() {}
};
