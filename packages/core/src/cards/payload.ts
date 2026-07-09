import type { CardDetail, CardCommentWithAuthor, CardMemberWithStaff } from "./queries";

/**
 * The full card payload assembled for a card-detail view.
 * This is the shape both web (API route) and mobile (react-query) assemble
 * and cache; making it explicit ensures the two clients agree.
 *
 * Mobile assembles it by calling:
 *   const detail = await getCardWithTimelineByProjectCode(supabase, code, slug);
 *   const [comments, members] = await Promise.all([
 *     getCardComments(supabase, detail.card.id),
 *     getCardMembers(supabase, detail.card.id),
 *   ]);
 *   return { ...detail, comments, members } satisfies CardPayload;
 */
export type CardPayload = CardDetail & {
  comments: CardCommentWithAuthor[];
  members: CardMemberWithStaff[];
};
