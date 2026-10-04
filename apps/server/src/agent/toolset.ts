// Which tools the agent gets: Composio app tools when COMPOSIO_API_KEY is set (any app, connected
// on demand), otherwise the native Google tools (also the MOCK_CONNECTORS demo fallback).
import { APP_TOOLS } from './appTools';
import { apiName, TOOLS, type ToolDef } from './tools';

const PET_WORK = TOOLS.find(t => t.name === 'pet.work')!;

/** Approvals created by the runner for "connect this app" cards (not a model-callable tool). */
export const CONNECT_TOOL = 'apps.connect';

export const toolset = (useComposio: boolean): ToolDef[] => (useComposio ? [...APP_TOOLS, PET_WORK] : TOOLS);

export const ANY_TOOL_BY_NAME = new Map([...TOOLS, ...APP_TOOLS].map(t => [t.name, t]));
export const byApiName = (tools: ToolDef[]) => new Map(tools.map(t => [apiName(t.name), t]));
