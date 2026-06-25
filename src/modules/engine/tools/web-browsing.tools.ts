import { Injectable } from '@nestjs/common';
import { BrowserService, BrowserScope } from '../../browser/browser.service';
import type { BrowserAction } from '../../browser/browser-session.service';
import { tool, type ToolContext, type ToolDefinition } from './types';

/**
 * Web-browsing tools for the coworker. Every tool drives the *same* shared
 * Playwright session the human's BrowserEditor uses (keyed by org+workspace),
 * so the coworker opens/reads/navigates exactly what the user sees — and the
 * user sees whatever the coworker does on the next screenshot poll.
 */
@Injectable()
export class WebBrowsingTools {
  constructor(private readonly browser: BrowserService) {}

  private scope(ctx: ToolContext): BrowserScope {
    return {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId ?? null,
      userId: ctx.actorUserId,
    };
  }

  build(): ToolDefinition[] {
    if (!this.browser.isEnabled()) return [];
    return [
      tool(
        'web.search',
        'Search the web (default engine: DuckDuckGo) and return ranked ' +
          'results with title, url and snippet. Use this to find pages, then ' +
          'web.open or web.read_page to read one.',
        {
          properties: {
            query: { type: 'string', description: 'The search query.' },
            engine: {
              type: 'string',
              description: "Optional engine, e.g. 'duckduckgo'.",
            },
          },
          required: ['query'],
        },
        async (input, ctx) => {
          const { results } = await this.browser.search(
            this.scope(ctx),
            String(input.query),
            typeof input.engine === 'string' ? input.engine : undefined,
          );
          return {
            output: { results },
            summary: `Found ${results.length} result(s) for "${String(
              input.query,
            )}".`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.read_page',
        'Read the text content of the page currently open in the workspace ' +
          'browser. Returns the title, url and extracted readable text. Use ' +
          'after web.open or web.search to actually read a page.',
        { properties: {} },
        async (_input, ctx) => {
          const content = await this.browser.content(this.scope(ctx));
          return {
            output: content,
            summary: `Read "${content.title || content.url}" (${
              content.text.length
            } chars).`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.open',
        "Open a URL in the user's workspace browser tab. The page loads in " +
          'the shared session so the user sees it live. Returns an intent the ' +
          'UI uses to open/focus the browser tab.',
        {
          properties: {
            url: { type: 'string', description: 'Full URL to open.' },
            title: { type: 'string', description: 'Optional tab title.' },
          },
          required: ['url'],
        },
        async (input, ctx) => {
          const state = await this.browser.navigate(
            this.scope(ctx),
            String(input.url),
          );
          const title =
            (typeof input.title === 'string' && input.title.trim()) ||
            state.title ||
            state.url;
          return {
            output: {
              intent: 'workspace.open',
              target: 'browser',
              id: state.url,
              title,
              url: state.url,
            },
            summary: `Opened ${state.url} in the browser.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.navigate',
        'Navigate the workspace browser: go back, forward, or reload the ' +
          'current page.',
        {
          properties: {
            direction: {
              type: 'string',
              enum: ['back', 'forward', 'reload'],
            },
          },
          required: ['direction'],
        },
        async (input, ctx) => {
          const state = await this.browser.action(this.scope(ctx), {
            type: input.direction as 'back' | 'forward' | 'reload',
          });
          return {
            output: state,
            summary: `Browser ${String(input.direction)} → ${state.url}`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.click',
        'Click at pixel coordinates (x, y) on the current browser page. ' +
          'Coordinates are relative to the page viewport.',
        {
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        async (input, ctx) => {
          const action: BrowserAction = {
            type: 'click',
            x: Number(input.x),
            y: Number(input.y),
          };
          const state = await this.browser.action(this.scope(ctx), action);
          return {
            output: state,
            summary: `Clicked (${action.x}, ${action.y}).`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.type',
        'Type text into the currently focused field on the browser page.',
        {
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        async (input, ctx) => {
          const state = await this.browser.action(this.scope(ctx), {
            type: 'type',
            text: String(input.text),
          });
          return {
            output: state,
            summary: `Typed ${String(input.text).length} chars.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'web.scroll',
        'Scroll the current browser page vertically by deltaY pixels ' +
          '(positive = down).',
        {
          properties: { deltaY: { type: 'number' } },
          required: ['deltaY'],
        },
        async (input, ctx) => {
          const state = await this.browser.action(this.scope(ctx), {
            type: 'scroll',
            deltaY: Number(input.deltaY),
          });
          return {
            output: state,
            summary: `Scrolled ${Number(input.deltaY)}px.`,
          };
        },
        { actionLevel: 1 },
      ),
    ];
  }
}
