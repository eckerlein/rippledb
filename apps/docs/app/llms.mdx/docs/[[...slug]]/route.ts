import { getLLMText, source } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;
export const dynamic = "force-static";

function keyOf(slug: string[]) {
  return slug.join("/");
}

function buildParentSlugSet() {
  const parent = new Set<string>();
  const slugs = source.getPages().map((p) => p.slugs);
  for (const slug of slugs) {
    for (let i = 1; i < slug.length; i++) {
      parent.add(keyOf(slug.slice(0, i)));
    }
  }
  return parent;
}

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  const resolvedSlug =
    !slug || slug.length === 0
      ? []
      : slug.length === 1 && slug[0] === "index"
        ? []
        : slug[slug.length - 1] === "index"
          ? slug.slice(0, -1)
          : slug;
  const page = source.getPage(resolvedSlug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  const parentSet = buildParentSlugSet();

  return source.getPages().map((page) => {
    // Avoid generating `/llms.mdx/docs/<folder>` as a file if `<folder>/...` exists.
    // Instead export to `/llms.mdx/docs/<folder>/index`.
    const slug = page.slugs.length === 0 ? ["index"] : page.slugs;
    const outSlug = parentSet.has(keyOf(slug)) ? [...slug, "index"] : slug;

    return { slug: outSlug };
  });
}
