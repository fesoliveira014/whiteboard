/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Review Desktop removes these native npm dependencies from package.json:
// their features (enterprise policy, native file copying, kerberos proxy auth,
// and the agent-host sandbox) are disabled or use fallback implementations.
// The declarations below reproduce each removed package's public typings so
// the lazy `await import(...)` call sites still typecheck. If a feature is
// ever revived, reinstall the package and delete its block here.

declare module '@vscode/policy-watcher' {
	export interface Watcher {
		dispose(): void;
	}

	type StringPolicy = { type: 'string' };
	type NumberPolicy = { type: 'number' };
	type BooleanPolicy = { type: 'boolean' };

	export interface Policies {
		[policyName: string]: StringPolicy | NumberPolicy | BooleanPolicy;
	}

	export interface WatcherOptions {
		registryPath?: string;
	}

	export type PolicyUpdate<T extends Policies> = {
		[K in keyof T]:
		| undefined
		| (T[K] extends StringPolicy
			? string
			: (T[K] extends BooleanPolicy
				? boolean
				: T[K] extends NumberPolicy
				? number
				: never));
	};

	export function createWatcher<T extends Policies>(
		productName: string,
		policies: T,
		onDidChange: (update: PolicyUpdate<T>) => void,
		options?: WatcherOptions
	): Watcher;
}

declare module '@vscode/fs-copyfile' {
	import type { CopyOptions } from 'node:fs';
	export function cp(src: string, dest: string, options?: CopyOptions): Promise<void>;
	export const copyFile: (src: string, dst: string, mode?: number) => Promise<void>;
	export const copyFileSync: (src: string, dst: string, mode?: number) => void;
	export const isCloneSupported: (path: string) => boolean;
	export const isMacOS: boolean;
}

declare module 'kerberos' {
	export interface KerberosClient {
		step(challenge: string): Promise<string>;
	}
	export function initializeClient(service: string, options?: object): Promise<KerberosClient>;
	const kerberos: {
		initializeClient(service: string, options?: object): Promise<KerberosClient>;
	};
	export default kerberos;
}

declare module '@microsoft/mxc-sdk' {
	export function getAvailableToolsPolicy(...args: any[]): any;
	export function getUserProfilePolicy(...args: any[]): any;
	export function getTemporaryFilesPolicy(...args: any[]): any;
	export function buildSandboxPayload(...args: any[]): any;
}
