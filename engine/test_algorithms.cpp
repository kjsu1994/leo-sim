// SPDX-License-Identifier: GPL-3.0-only
// Modified/adapted 2026-11-16; see ../THIRD_PARTY_NOTICES.txt.
#include "algorithms.h"
#include <cassert>
int main() {
  std::vector<std::vector<Edge>> g(5);
  auto add = [&](int a, int b, double d) {
    g[a].push_back({b, d});
    g[b].push_back({a, d});
  };
  add(0, 1, 1);
  add(1, 2, 1);
  add(2, 3, 1);
  add(0, 3, 10);
  auto a = dijkstra(g, 3, false), b = dijkstra(g, 3, true);
  assert(a.next[0] == 1 && a.cost[0] == 3);
  assert(b.next[0] == 3);
  assert(a.next[4] == -1);
  assert(a.hops[3] == 0 && b.hops[3] == 0);
  assert(a.hops[2] == 1 && a.hops[0] == 3);
  assert(b.hops[0] == 1);
  assert(a.hops[4] == -1 && b.hops[4] == -1);
  g.assign(4, {});
  add(0, 1, 1);
  add(0, 2, 1);
  add(1, 3, 1);
  add(2, 3, 1);
  assert(dijkstra(g, 3, false).next[0] == 1);
}
