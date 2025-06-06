<script lang="ts">
	import Loading from '../../components/Loading.svelte';
	import { onMount } from 'svelte';
	import { get, lang, post } from '$lib/utils';
	import * as m from '$lib/paraglide/messages.js';
	import {
		Dot,
		EllipsisVertical,
		Eye,
		Image,
		Network,
		Pen,
		Save,
		Trash,
		Trees
	} from '@lucide/svelte';
	import { Toaster, createToaster } from '@skeletonlabs/skeleton-svelte';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import IconX from '@lucide/svelte/icons/x';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { default_icon, mapNumberToVisiblity, type DocumentMeta } from './types';
	import { user } from '../../store';
	import type { ExoData } from '@exomatique_editor/base';
	import Editor from './Editor.svelte';
	import VisibilityBadge from '../../components/document/VisibilityBadge.svelte';
	import IconPicker from '../../components/utils/IconPicker.svelte';
	import type { IconMeta } from '$lib/types';
	import DocumentIcon from '../../components/document/DocumentIcon.svelte';
	import FileExplorer from '$lib/file/FileExplorer.svelte';
	import { getChildAddress, getFileName, getRootAddress, read, write } from '$lib/file/distant_fs';
	import type { FileAddress, PageFile } from '$lib/file/types';
	import type { PageData } from '$lib/page';
	import { href } from '$lib/page/links';
	import { resolvePageAddress } from '$lib/utils/link';
	import NavigationModule from '$lib/editor/navigation/NavigationModule';
	import { MdModule } from '@exomatique_editor/md';
	import fileLinkExtension from '$lib/editor/markdown/FileLinkExtension';
	import { updated } from '$app/state';

	interface ComboboxData {
		label: string;
		value: string;
	}

	let tagsData: ComboboxData[] | undefined = $state(undefined);

	let {
		address = $bindable(),
		onFetchFail = () => {}
	}: {
		address: FileAddress;
		onFetchFail?: () => void;
	} = $props();

	let real_address = $derived.by(() => resolvePageAddress(address));

	let isSaving = $state(false);
	let lastSaved = $state(new Date().getTime());

	let saveTimeout: NodeJS.Timeout | undefined;

	let lastSavedPage = JSON.stringify({});
	let lastSavedDocument = JSON.stringify({});

	let _document = $state(undefined as DocumentMeta | undefined);
	let _page = $state(undefined as PageFile | undefined);

	$effect(() => {
		// Use data to have svelte call effect when they are updated
		_page?.data.title;
		_page?.data.content;
		_page?.data.icon;
		_document?.icon;
		_document?.tags;
		_document?.visibility;
		_document?.title;

		resetSaveTimeout();
	});

	function resetSaveTimeout() {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			save(true);
		}, 10000);
	}

	async function save(autosave?: boolean) {
		if (!_page || !_document) return;

		const trimmedPage = JSON.stringify({
			..._page,
			updated: undefined
		});

		const trimmedDocument = JSON.stringify({
			..._document,
			updated: undefined
		});

		const langs = {
			save_fail: undefined,
			saved: undefined,
			saving: undefined,
			saving_description: undefined,
			saved_description: undefined,
			save_fail_description: undefined,
			auto_saving_description: undefined,
			auto_saved_description: undefined
		};

		await Promise.all(Object.keys(langs).map(async (v) => [v, (await lang(v)) || v])).then((list) =>
			list.forEach(([v, lang_value]) => ((langs as any)[v] = lang_value))
		);

		isSaving = true;
		const tasks = [
			lastSavedPage !== trimmedPage
				? write(real_address, 'page', _page.data satisfies PageData).then((page) => {
						lastSavedPage = JSON.stringify({
							...page,
							updated: undefined
						});
					})
				: undefined,

			lastSavedDocument !== trimmedDocument
				? post('/document', { meta: _document }).then((document) => {
						lastSavedDocument = JSON.stringify({
							...document,
							updated: undefined
						});
					})
				: undefined
		].filter((v) => v !== undefined);

		if (tasks.length === 0) {
			isSaving = false;
			return;
		}

		lastSaved = new Date().getTime();

		toaster.promise(
			Promise.all(tasks).finally(() => (isSaving = false)),
			{
				loading: {
					title: langs.saving,
					description: autosave ? langs.auto_saving_description : langs.saving_description
				},
				success: () => ({
					title: langs.saved,
					description: autosave ? langs.auto_saved_description : langs.saved_description
				}),
				error: (e) => {
					console.error(e);
					return {
						title: langs.save_fail,
						description: langs.save_fail_description
					};
				}
			}
		);
	}

	function loadPage() {
		if (_document?.id !== real_address.document_id) {
			get('/document', { document_id: real_address.document_id })
				.then((v) => {
					const document_meta = v.meta as DocumentMeta;

					_document = document_meta;
					const savedDocument = {
						..._document,
						updated: undefined
					} satisfies Partial<DocumentMeta>;
					lastSavedDocument = JSON.stringify(savedDocument);
					resetSaveTimeout();
				})
				.catch((e) => {
					console.error(e);
					onFetchFail();
				});
		}

		get('/tags').then((v) => {
			tagsData = v.data as ComboboxData[];
		});

		read(real_address, 'page')
			.then((unsafe_file) => {
				if (!unsafe_file) throw new Error('File not found');
				if (!(unsafe_file as any satisfies PageFile)) throw new Error('File is not a page');

				_page = unsafe_file as PageFile;

				const savedPage = {
					..._page,
					updated: undefined
				} satisfies Partial<PageFile>;
				lastSavedPage = JSON.stringify(savedPage);

				resetSaveTimeout();
			})
			.catch((e) => {
				console.error(e);
				onFetchFail();
			});
	}

	onMount(() => {
		loadPage();
	});

	$effect(() => {
		real_address;
		loadPage();
	});

	let deletePopoverState = $state(false);
	let deletionConfirmText = $state('');

	function deletePopoverClose() {
		deletionConfirmText = '';
		deletePopoverState = false;
	}

	async function deleteDocument() {
		if (deletionConfirmText !== _document?.title) return;
		await post('/document/delete', real_address).finally(() => goto('/documents'));
	}

	const toaster = createToaster({ placement: 'bottom-end' });

	let tagContainer: HTMLElement | undefined = $state(undefined);
	let tag_select = $state(0);
	let filterTag = $state('');

	let filtered = $derived(
		((tagsData as any as ComboboxData[]) || [])
			.filter((v) => v.label.toLocaleLowerCase().startsWith(filterTag.toLowerCase()))
			.filter((v) => !_document?.tags.includes(v.value))
	);

	function onChoice(choice_index: number) {
		if (!_document) return;
		_document.tags.push(filtered[choice_index].value);
	}

	let iconPopover = $state(false);
	let pageIconPopover = $state(false);

	let root = $derived(getRootAddress(address.document_id));

	beforeNavigate(() => {
		save(true);
	});

	afterNavigate(() => {
		let v = document.getElementById('pane');
		if (!v) return;
		v.scrollIntoView({
			block: 'end',
			behavior: 'instant'
		});
	});

	let container: HTMLElement;
	let dragHandle: HTMLElement;
	let leftPanel: HTMLElement;
	let rightPanel: HTMLElement;

	onMount(() => {
		let isDragging = false;
		dragHandle.addEventListener('mousedown', (e) => {
			isDragging = true;
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
		});

		dragHandle.addEventListener('dblclick', (e) => {
			leftPanel.style.width = `${25}%`;
			rightPanel.style.width = `${75}%`;
		});

		document.addEventListener('mouseup', (e) => {
			isDragging = false;
			document.body.style.cursor = 'default';
			document.body.style.userSelect = '';
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;

			const containerRect = container.getBoundingClientRect();
			let offsetX = e.clientX - containerRect.left;
			const containerWidth = containerRect.width;

			// Prevent extreme values
			const minWidth = 400; // px
			const maxWidth = containerWidth - 400;

			if (offsetX < minWidth) {
				if (offsetX / containerWidth < 0.05) {
					offsetX = 0;
				} else offsetX = minWidth;
			}

			if (offsetX > maxWidth) {
				if (offsetX / containerWidth > 0.95) {
					offsetX = containerWidth;
				} else offsetX = containerWidth - 400;
			}

			const leftPanelWidthPercent = (offsetX / containerWidth) * 100;
			const rightPanelWidthPercent = 100 - leftPanelWidthPercent;

			leftPanel.style.width = `${leftPanelWidthPercent}%`;
			rightPanel.style.width = `${rightPanelWidthPercent}%`;
		});
	});
</script>

<Toaster {toaster}></Toaster>

<svelte:head>
	<title>Editing : {_page?.data.title || ''} IN {_document?.title || ''}</title>
</svelte:head>

<div id="document_pane" class="relative flex h-full flex-1 flex-col items-center">
	<div bind:this={container} id="pane" class="relative flex min-h-dvh w-full grow flex-row">
		<div
			bind:this={leftPanel}
			class="bg-surface-900 m-2 flex h-dvh min-h-0 w-1/4 flex-col overflow-hidden rounded-md"
		>
			<div class="mb-5 flex w-full flex-col">
				{#if _document}
					<input
						class="h4 mx-7 my-2 w-full outline-none"
						maxlength="128"
						type="text"
						bind:value={_document.title}
					/>
				{/if}
				<div class="flex flex-row">
					<div class="h-fil mx-5 w-fit">
						<Popover open={iconPopover}>
							{#snippet trigger()}
								<button onclick={() => (iconPopover = true)}>
									<DocumentIcon
										icon={_document?.icon || {
											library: 'lucide',
											value: 'Image'
										}}
										backgroundColor="white"
										size={96}
									/>
								</button>
							{/snippet}

							{#snippet content()}
								<article class="flex justify-between">
									<IconPicker
										onSubmit={(v) => {
											if (!_document) return;
											_document.icon = v;
											iconPopover = false;
										}}
										onQuit={() => (iconPopover = false)}
										selected_icon={_document?.icon}
									/>
								</article>
							{/snippet}
						</Popover>
					</div>
					<div class="mt-2">
						<div class="flex w-full grow flex-wrap justify-start gap-1">
							{#if _document}
								<button
									title={_document.visibility === 'PRIVATE'
										? m.private_description()
										: _document.visibility === 'PUBLIC'
											? m.protected_description()
											: m.public_description()}
									onclick={() => {
										if (!_document) return;
										if (_document.visibility === 'PRIVATE') _document.visibility = 'PROTECTED';
										else if (_document.visibility === 'PUBLIC') _document.visibility = 'PRIVATE';
										else _document.visibility = 'PUBLIC';
									}}
								>
									<VisibilityBadge value={_document.visibility} />
								</button>
							{/if}
							{#each (tagsData || []).filter((v) => _document?.tags.includes(v.value)) as tag}
								<button
									class="button btn-base chip preset-filled h-fit"
									onclick={() => {
										if (!_document) return;
										_document.tags = _document.tags.filter((v) => tag.value !== v);
									}}>{tag.label} x</button
								>
							{/each}

							<Popover
								positioning={{ placement: 'top' }}
								triggerBase="hover:bg-surface-100 ignore-focus px-2 rounded-lg btn-base"
								contentBase="scheme-light text-neutral-950 flex flex-col relative rounded-lg border-2 border-surface-300 bg-surface-50 p-2"
								arrow
								arrowBackground="!bg-surface-200 dark:!bg-surface-800"
							>
								{#snippet trigger()}
									<i class="fa-solid fa-plus"></i>
								{/snippet}

								{#snippet content()}
									<div
										role="none"
										class="bg-surface-100 m-2 flex flex-row items-center rounded-lg p-1"
										onkeydown={(e) => {
											if (e.key === 'ArrowUp') {
												tag_select = Math.max(tag_select - 1, 0);
												tagContainer?.children[tag_select].scrollIntoView(false);
											} else if (e.key === 'ArrowDown') {
												tag_select = Math.min(tag_select + 1, filtered.length - 1);
												tagContainer?.children[tag_select].scrollIntoView(false);
											} else if (e.key === 'Enter' || e.key === 'Space') {
												onChoice(tag_select);
											}
										}}
									>
										<i class="fa-solid fa-magnifying-glass mx-2"></i>
										<input
											class="bg-surface-100 outline-none"
											bind:value={filterTag}
											onchange={() => (tag_select = -1)}
										/>
									</div>

									<div
										bind:this={tagContainer}
										class="ignore-focus flex max-h-40 flex-1 flex-col overflow-scroll"
									>
										{#each filtered.map( (v, i) => ({ index: i, value: v.label }) ) as { index, value: k }}
											<button
												class="hover:bg-surface-100 m-1 flex flex-1 flex-row items-center gap-5 rounded-lg px-4"
												class:bg-surface-100={tag_select === index}
												onclick={() => {
													onChoice(index);
												}}
												onmouseenter={() => {
													tag_select = index;
												}}
												onmouseleave={() => {
													tag_select = -1;
												}}
											>
												{k}
											</button>
										{/each}
									</div>
								{/snippet}
							</Popover>
						</div>
					</div>
				</div>
			</div>

			<div class="shrink grow basis-auto overflow-y-auto">
				<FileExplorer address={root} />
			</div>

			<div class="bg-surface-900 my-5 flex w-full flex-row gap-5">
				<a
					class="btn bg-surface-600 hover:bg-surface-400 grow self-end"
					href={href(address)}
					class:disabled={isSaving}
					onclick={() => save()}
					>View <Eye size={16} />
				</a>
				<button
					class="btn bg-surface-600 hover:bg-surface-400 grow self-end"
					class:disabled={isSaving}
					onclick={() => save()}
					>Save <Save size={16} />
				</button>

				<button
					class="btn right-5 bottom-5 grow border-2 border-red-400 shadow-sm shadow-red-400"
					onclick={() => (deletePopoverState = true)}
				>
					<Trash color="red" />
				</button>
			</div>
		</div>
		<div
			bind:this={dragHandle}
			class="bg-surface-900 flex cursor-col-resize flex-col justify-center"
		>
			<EllipsisVertical />
		</div>
		<div
			bind:this={rightPanel}
			id="editor_pane"
			class="m-2 max-h-dvh w-3/4 overflow-scroll rounded-md bg-white p-2 py-4 text-neutral-950 scheme-light"
		>
			{#if _page !== undefined}
				<div class="mx-5 flex flex-row">
					<Popover open={pageIconPopover}>
						{#snippet trigger()}
							<button onclick={() => (pageIconPopover = true)}>
								<DocumentIcon
									icon={_page?.data.icon || default_icon}
									backgroundColor="white"
									size={96}
								/>
							</button>
						{/snippet}

						{#snippet content()}
							<article class="flex justify-between">
								<IconPicker
									onSubmit={(v) => {
										if (_page) _page.data.icon = v;
										pageIconPopover = false;
									}}
									onQuit={() => (pageIconPopover = false)}
									selected_icon={_page?.data.icon}
								/>
							</article>
						{/snippet}
					</Popover>

					<input
						type="text"
						bind:value={_page.data.title}
						class="h4 mx-5 my-1 px-1 py-2 outline-none"
					/>
				</div>
				<Editor
					editable
					bind:data={_page.data.content}
					extra_modules={[new NavigationModule()]}
					provideContext={(editor) => {
						editor.addContext(
							'root',
							getRootAddress(address.document_id),
							editor.modules['navigation']
						);

						editor.addContext('resolver', (v: FileAddress) => href(v, true));

						const MdModule = editor.modules['md'] as MdModule;

						MdModule.extra_plugins.push({
							type: 'remark',
							plugin: () =>
								fileLinkExtension((v: string) =>
									href(
										{
											document_id: address.document_id,
											path: v
										},
										true
									)
								)
						});
					}}
				/>
			{:else}
				<div class="flex h-full w-full justify-center">
					<Loading size={'extra-large'} />
				</div>
			{/if}
		</div>
	</div>
</div>

{#if deletePopoverState && _document}
	<div
		class="bg-surface-950 absolute top-0 left-0 flex h-full w-full flex-1 items-center justify-center opacity-90"
	>
		<Popover
			open={deletePopoverState}
			modal
			onOpenChange={(e) => (deletePopoverState = e.open)}
			positioning={{ placement: 'top' }}
			contentBase="card bg-surface-200-800 border-2 border-red-400 p-4 space-y-4"
			arrow
			arrowBackground=""
		>
			{#snippet trigger()}{/snippet}
			{#snippet content()}
				<header class="flex justify-between">
					<p class="text-xl font-bold">{m.document_confirm_delete()}</p>
					<button class="btn-icon hover:preset-tonal" onclick={deletePopoverClose}><IconX /></button
					>
				</header>
				<article>
					<p class="text-red-400">
						{m.document_confirm_delete_text_0()}
					</p>
					<p>
						{m.document_confirm_delete_text_1()}
					</p>

					<div class="mt-2 flex flex-row items-center gap-5">
						<input
							class="input bg-surface-950 text-red-500 outline-none selection:outline-none placeholder:text-red-400 placeholder:opacity-50"
							placeholder={_document?.title}
							bind:value={deletionConfirmText}
						/>

						<button
							class="btn m-2 border-2 border-red-600"
							disabled={deletionConfirmText !== _document?.title}
							onclick={deleteDocument}
						>
							<Trash color="red" />
						</button>
					</div>
					<p class={`${deletionConfirmText === _document?.title ? 'invisible' : ''} opacity-70`}>
						{m.document_confirm_fail({ title: _document?.title || '' })}
					</p>
				</article>
			{/snippet}
		</Popover>
	</div>
{/if}

<style>
	:global(.ig-input) {
		outline-style: none;
	}
</style>
