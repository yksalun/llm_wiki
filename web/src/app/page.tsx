import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="relative min-h-[calc(100vh-0px)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.08),transparent_24%)]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-16 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.25fr_0.85fr] lg:items-end">
          <div className="space-y-6">
            <Badge variant="outline" className="w-fit border-amber-500/30 bg-background/80 text-amber-700 shadow-sm backdrop-blur">
              Task 1 foundation
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
                A clean place to start the LLM Wiki web stack.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                The app shell is now wired for Next.js, shadcn, Zustand, Motion,
                and Drizzle. This page stays intentionally spare until the real
                product surfaces are ready.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="#foundation"
                className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Review the scaffold
              </a>
              <a
                href="#next"
                className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-background/70 px-4 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted"
              >
                See what comes next
              </a>
            </div>
          </div>

          <Card
            id="foundation"
            className="border-border/70 bg-background/80 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          >
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-xl">Foundation status</CardTitle>
              <CardDescription>
                The minimal pieces needed for the next task are in place.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div>
                  <p className="text-sm font-medium">Package stack</p>
                  <p className="text-sm text-muted-foreground">
                    Zustand, Motion, Drizzle ORM, and pg are installed.
                  </p>
                </div>
                <Badge variant="secondary">Ready</Badge>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div>
                  <p className="text-sm font-medium">Tooling</p>
                  <p className="text-sm text-muted-foreground">
                    Type checking, tests, and database scripts are wired in.
                  </p>
                </div>
                <Badge variant="outline">Wired</Badge>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div>
                  <p className="text-sm font-medium">UI shell</p>
                  <p className="text-sm text-muted-foreground">
                    Layout and homepage now read like an application, not a
                    template.
                  </p>
                </div>
                <Badge variant="outline">Updated</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div
          id="next"
          className="mt-10 grid gap-4 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:grid-cols-3"
        >
          <p>1. Replace the placeholder page with the first real workspace surface.</p>
          <p>2. Add actual schema tables and wire the database layer to the app.</p>
          <p>3. Grow the state and motion systems only where the product needs them.</p>
        </div>
      </section>
    </main>
  );
}
