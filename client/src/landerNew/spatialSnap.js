const SNAP_PX = 6;

export function buildPageGuides(clientWidth, clientHeight) {
  return [
    { orientation: "vertical",   position: clientWidth / 2,       kind: "page-center" },
    { orientation: "horizontal", position: clientHeight / 2,      kind: "page-center" },
    { orientation: "vertical",   position: clientWidth / 3,       kind: "page-third"  },
    { orientation: "vertical",   position: (clientWidth * 2) / 3, kind: "page-third"  },
  ];
}

export function buildElementGuides(bounds, excludeTargetId) {
  const out = [];
  for (const b of bounds) {
    if (b.targetId === excludeTargetId) continue;
    const { left, top, width, height } = b.rect;
    out.push(
      { orientation: "vertical",   position: left,             kind: "element-edge"   },
      { orientation: "vertical",   position: left + width,     kind: "element-edge"   },
      { orientation: "vertical",   position: left + width / 2, kind: "element-center" },
      { orientation: "horizontal", position: top,              kind: "element-edge"   },
      { orientation: "horizontal", position: top + height,     kind: "element-edge"   },
      { orientation: "horizontal", position: top + height / 2, kind: "element-center" },
    );
  }
  return out;
}

export function snapBoxToGuides(left, top, width, height, guides) {
  const cx = [left, left + width / 2, left + width];
  const cy = [top, top + height / 2, top + height];
  let nl = left, nt = top;
  const active = [];
  for (const g of guides) {
    if (g.orientation === "vertical") {
      for (const x of cx) {
        if (Math.abs(x - g.position) <= SNAP_PX) {
          nl = left + (g.position - x);
          active.push(g);
          break;
        }
      }
    } else {
      for (const y of cy) {
        if (Math.abs(y - g.position) <= SNAP_PX) {
          nt = top + (g.position - y);
          active.push(g);
          break;
        }
      }
    }
  }
  return { left: nl, top: nt, active };
}
