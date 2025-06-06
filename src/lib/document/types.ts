import type { FileAddress } from '$lib/file/types';
import type { IconMeta } from '$lib/types';

export type DocumentVisibility = 'PUBLIC' | 'PROTECTED' | 'PRIVATE';

export interface DocumentMeta {
	id: string;
	title: string;
	author: string;
	authorId: string;
	visibility: DocumentVisibility;
	created: Date;
	updated: Date;
	icon: IconMeta;
	tags: string[];
}

export const default_icon: IconMeta = {
	library: 'lucide',
	value: 'Image',
	numbering: undefined
};

export function mapVisibilityToNumber(visibility: DocumentVisibility) {
	switch (visibility) {
		case 'PUBLIC':
			return 1;
		case 'PROTECTED':
			return 0;
		default:
			return -1;
	}
}

export function mapNumberToVisiblity(visibility: number): DocumentVisibility {
	if (visibility === 1) {
		return 'PUBLIC';
	} else if (visibility === 0) {
		return 'PROTECTED';
	} else {
		return 'PRIVATE';
	}
}
