import { Suspense } from "react";
import { LibraryFallback, LibraryView } from "@/components/library-view";

export default function HomePage() {
  // The library reads its search from the address bar, which only exists in
  // the browser, so the prerendered page carries the fallback until then.
  return (
    <Suspense fallback={<LibraryFallback />}>
      <LibraryView />
    </Suspense>
  );
}
