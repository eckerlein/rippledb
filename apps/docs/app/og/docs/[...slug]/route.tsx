import { getPageImage, source } from "@/lib/source";
import { readFile } from "fs/promises";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { join } from "path";

export const revalidate = false;
export const dynamic = "force-static";

function CustomOGImage({ description }: { description?: string }) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
        padding: "80px",
        fontFamily: "Inter",
      }}
    >
      {/* Header with icon and site name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "42px",
          marginBottom: "80px",
        }}
      >
        {/* Icon - recreated with basic shapes */}
        <div
          style={{
            width: "210",
            height: "210",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Outer circles */}
          <div
            style={{
              position: "absolute",
              width: "116",
              height: "116",
              borderRadius: "50%",
              border: "7px solid",
              borderColor: "rgba(59, 130, 246, 0.5)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "158",
              height: "158",
              borderRadius: "50%",
              border: "11px solid",
              borderColor: "rgba(59, 130, 246, 0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "193",
              height: "193",
              borderRadius: "50%",
              border: "7px solid",
              borderColor: "rgba(59, 130, 246, 0.3)",
            }}
          />
          {/* Center circle with gradient */}
          <div
            style={{
              width: "56",
              height: "56",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
            }}
          />
          {/* Accent dots */}
          <div
            style={{
              position: "absolute",
              top: "39",
              right: "39",
              width: "25",
              height: "25",
              borderRadius: "50%",
              background: "#60a5fa",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "39",
              left: "39",
              width: "25",
              height: "25",
              borderRadius: "50%",
              background: "#7c3aed",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "92",
              fontWeight: 600,
              color: "#ffffff",
              display: "flex",
              alignItems: "baseline",
              gap: "7px",
              fontFamily: "Inter",
            }}
          >
            <span>Ripple</span>
            <span
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
                fontWeight: 600,
                fontFamily: "Inter",
              }}
            >
              DB
            </span>
          </div>
          <div
            style={{
              fontSize: "45",
              color: "#9ca3af",
              fontFamily: "Inter",
            }}
          >
            Documentation
          </div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontSize: "36",
            color: "#d1d5db",
            textAlign: "center",
            maxWidth: "1400px",
            lineHeight: "1.4",
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
}

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/docs/[...slug]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // Load Inter SemiBold font (static TTF, not variable font)
  // Place font file at: apps/docs/app/og/fonts/Inter_28pt-SemiBold.ttf
  // Or download from: https://fonts.google.com/specimen/Inter
  // Path is relative to monorepo root (where pnpm dev runs from)
  const fontPath = join(process.cwd(), "/app/og/fonts/Inter_28pt-SemiBold.ttf");
  let interSemiBold: Buffer | null = null;
  try {
    interSemiBold = await readFile(fontPath);
  } catch {
    // Font file not found, will use system font fallback
    console.warn(`Font file not found at ${fontPath}, using system font`);
  }

  return new ImageResponse(
    <CustomOGImage description={page.data.description} />,
    {
      width: 1200,
      height: 630,
      fonts: interSemiBold
        ? [
            {
              name: "Inter",
              data: interSemiBold,
              style: "normal",
              weight: 600, // SemiBold
            },
          ]
        : undefined,
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageImage(page).segments,
  }));
}
