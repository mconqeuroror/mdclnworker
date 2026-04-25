import React from "react";
import NSFWPage from "../NSFWPage";

export default function ProNSFWPage() {
  return (
    <div className="min-h-full">
      <NSFWPage embedded sidebarCollapsed={false} />
    </div>
  );
}
