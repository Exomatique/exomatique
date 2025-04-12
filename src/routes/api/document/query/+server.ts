import type { RequestHandler } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/client';

export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(auth.sessionCookieName);

	let user;
	if (token) {
		user = await auth.validateSessionToken(token).then((v) => v.user);
	}

	let title = event.url.searchParams.get('title') || '';
	let author = event.url.searchParams.get('author') || '';
	let skip = Number.parseInt(event.url.searchParams.get('skip') || '0');
	let size = Math.min(Number.parseInt(event.url.searchParams.get('size') || '20'), 20);

	let count = 0;
	const data = (
		await prisma.document.findMany({
			skip,
			take: size,
			include: {
				Exercise: true,
				author: true
			},
			where: {
				OR: [
					{
						authorId: user?.id || ''
					},
					{
						visibility: 1
					}
				],
				title: {
					startsWith: title
				},
				author: author
					? {
							id: author
						}
					: undefined
			}
		})
	).map((v) => {
		return {
			title: v.title,
			authorId: v.authorId,
			author: v.author.name,
			visibility: v.visibility,
			type: v.Exercise ? 'Exercise' : 'Document',
			id: v.id
		};
	});

	return json({ ok: 1, data, amount: count });
};
