/**
 * Attach panel: the composer's picker, one tab per `AttachmentSource`
 * (src/attachments.ts). The package ships the assets source; hosts add
 * their own via `<AnnoKitProvider attachmentSources={…}>`, and this panel
 * renders whatever it is given — it knows about items and groups, never
 * about any particular source's domain.
 *
 * Fail-soft like the rest of the package: every source lists in the
 * background, a failed or empty fetch shows that source's one-line empty
 * copy, and nothing here blocks the composer or throws into the app.
 */

import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { clampItems } from "./attachments";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import type { AttachmentItem, AttachmentSource } from "./attachments";
import { AnnoKitIcon } from "./icon";
import type { AnnoKitTransport } from "./transport";

interface Props {
  transport: AnnoKitTransport;
  sources: AttachmentSource[];
  /** Currently attached items, keyed by `id` (toggle semantics). */
  selected: AttachmentItem[];
  onToggle: (item: AttachmentItem) => void;
  onClose: () => void;
  /**
   * The composer sheet's measured height: the panel COVERS the sheet it
   * came from, edge to edge, instead of choosing its own size — one
   * silhouette, stacked. Absent = the old cap (70% of the screen).
   */
  height?: number;
}

export function AnnoKitAttachPanel({
  transport,
  sources,
  selected,
  onToggle,
  onClose,
  height,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const [tabKey, setTabKey] = useState(sources[0]?.key ?? "");
  // null = still listing; [] = listed and empty (or failed — same copy).
  const [items, setItems] = useState<Record<string, AttachmentItem[] | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const source of sources) {
      void source
        .list(transport)
        .catch(() => [] as AttachmentItem[])
        .then((list) => {
          // A source is host code reading a server: neither is trusted to
          // return a bounded list (src/limits.ts). Trimmed rather than
          // rejected — a picker showing the first 200 of a runaway list is
          // still useful, where an empty one is not.
          if (!cancelled) setItems((prev) => ({ ...prev, [source.key]: clampItems(list) }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [transport, sources]);

  const active = sources.find((s) => s.key === tabKey) ?? sources[0];
  const picked = (item: AttachmentItem) => selected.some((s) => s.id === item.id);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          // The tap-outside affordance. A screen reader reaches Done; an
          // unlabelled full-screen button in the reading order is noise.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View
          style={[styles.panel, height !== undefined ? { height } : null]}
          testID="annokit-attach-panel"
        >
          <View style={styles.header}>
            <View style={styles.tabs}>
              {sources.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => setTabKey(s.key)}
                  style={[styles.tab, s.key === active?.key && styles.tabActive]}
                  testID={`annokit-attach-tab-${s.key}`}
                  accessibilityRole="tab"
                  accessibilityLabel={`${s.title} attachments`}
                  accessibilityState={{ selected: s.key === active?.key }}
                >
                  <Text style={[styles.tabText, s.key === active?.key && styles.tabTextActive]}>
                    {s.title}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              testID="annokit-attach-close"
              accessibilityRole="button"
              // A close, not "Done": a pick applies as it is tapped.
              accessibilityLabel="Close attachments"
            >
              <AnnoKitIcon name="close" size={18} color={p.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {active == null ? null : items[active.key] === undefined ||
              items[active.key] === null ? (
              <Text style={styles.muted}>Loading…</Text>
            ) : items[active.key]!.length === 0 ? (
              <Text style={styles.muted}>{active.emptyText}</Text>
            ) : (
              renderItems(items[active.key]!, picked, onToggle, styles)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Rows in list order, with a heading wherever `group` changes — sources
 * control grouping entirely through item order.
 */
function renderItems(
  list: AttachmentItem[],
  picked: (item: AttachmentItem) => boolean,
  onToggle: (item: AttachmentItem) => void,
  styles: ReturnType<typeof useStyles>,
) {
  const out: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  for (const item of list) {
    if (item.group !== undefined && item.group !== lastGroup) {
      out.push(
        <Text key={`group-${item.group}`} style={styles.groupTitle}>
          {item.group}
        </Text>,
      );
    }
    lastGroup = item.group;
    const isPicked = picked(item);
    out.push(
      <Pressable
        key={item.id}
        onPress={() => onToggle(item)}
        style={[styles.row, isPicked && styles.rowPicked]}
        testID={`annokit-attach-item-${item.id}`}
        accessibilityRole="checkbox"
        accessibilityLabel={item.subtitle ? `${item.title}, ${item.subtitle}` : item.title}
        accessibilityState={{ checked: isPicked }}
      >
        {item.thumbnailUri !== undefined ? (
          <Image source={{ uri: item.thumbnailUri }} style={styles.thumb} />
        ) : null}
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        <Check checked={isPicked} styles={styles} />
      </Pressable>,
    );
  }
  return out;
}

function Check({ checked, styles }: { checked: boolean; styles: ReturnType<typeof useStyles> }) {
  const { palette: p } = useAnnoKitTheme();
  return (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <AnnoKitIcon name="check" size={12} color={p.onAccent} />}
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  backdrop: {
    flex: 1,
    backgroundColor: p.backdrop,
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  panel: {
    maxHeight: "70%",
    backgroundColor: p.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: p.border,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  tabs: {
    flexDirection: "row",
    gap: 6,
  },
  tab: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: p.agentTintMid,
  },
  tabText: {
    color: p.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  tabTextActive: {
    color: p.textStrong,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  muted: {
    color: p.textFaint,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 10,
  },
  rowPicked: {
    backgroundColor: p.agentTintSoft,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: p.textBody,
    fontSize: 13,
  },
  rowMeta: {
    color: p.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: p.raised,
  },
  groupTitle: {
    color: p.textStrong,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    marginTop: 10,
    marginBottom: 2,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: p.control,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: p.agent,
    borderColor: p.agent,
  },
}));
