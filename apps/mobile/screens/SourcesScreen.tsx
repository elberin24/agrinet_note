// 취재원 정보 — 프론트엔드 시안 (백엔드 연동은 이후 단계)
// 목록: 정사각 사진(없으면 기본 프로필) + 이름/소속/전화
// 상세: 세로 스크롤, 인적 사항 + 연결된 녹음 히스토리(연동 예정)
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { C } from "../theme";

interface SourceProfile {
  id: string;
  name: string;
  org: string;
  title: string;
  phone: string;
  note: string;
}

// 프론트엔드 시안용 예시 데이터 — 이후 Supabase sources 테이블로 대체 예정
const SAMPLE_SOURCES: SourceProfile[] = [
  {
    id: "1",
    name: "김방역",
    org: "농림축산식품부",
    title: "구제역방역과 과장",
    phone: "044-201-0000",
    note: "럼피스킨·ASF 담당. 브리핑 후 개별 질의 응대에 호의적.",
  },
  {
    id: "2",
    name: "이어촌",
    org: "수협중앙회",
    title: "어촌지원부 부장",
    phone: "02-2240-0000",
    note: "TAC·어촌계 현안. 통화 선호, 오전 연락이 좋음.",
  },
  {
    id: "3",
    name: "박직불",
    org: "한국농촌경제연구원",
    title: "연구위원",
    phone: "061-820-0000",
    note: "공익직불제 연구. 수치 자료 요청 가능.",
  },
];

function DefaultAvatar({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: 14,
        backgroundColor: "#D8DCCF", alignItems: "center", justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.45 }}>👤</Text>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={s.back}>‹</Text>
      </Pressable>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 24 }} />
    </View>
  );
}

function SourceDetail({
  source,
  onBack,
}: {
  source: SourceProfile;
  onBack: () => void;
}) {
  return (
    <View style={s.screen}>
      <Header title="취재원 정보" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={s.detailTop}>
          <DefaultAvatar size={84} />
          <Text style={s.detailName}>{source.name}</Text>
          <Text style={s.detailOrg}>{source.org} · {source.title}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>연락처</Text>
          <Text style={s.cardValue}>{source.phone}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.cardLabel}>메모</Text>
          <Text style={s.cardValue}>{source.note}</Text>
        </View>

        <View style={s.historyHead}>
          <Text style={s.section}>녹음 히스토리</Text>
          <Pressable
            onPress={() =>
              Alert.alert(
                "준비 중",
                "녹음 파일에 취재원을 연결하는 기능은 다음 단계에서 제공됩니다."
              )
            }
          >
            <Text style={s.link}>+ 녹음 연결</Text>
          </Pressable>
        </View>
        <View style={s.emptyHistory}>
          <Text style={s.emptyText}>
            아직 연결된 녹음이 없습니다.{"\n"}
            녹음·통화녹음 파일을 이 취재원과 연결하면{"\n"}
            취재 이력이 시간순으로 쌓입니다.
          </Text>
        </View>
        <Text style={s.futureNote}>
          예정: 녹음이 쌓이면 음성을 분석해 새 파일에 자동으로 취재원 태그를 붙입니다.
        </Text>
      </ScrollView>
    </View>
  );
}

export function SourcesScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<SourceProfile | null>(null);

  if (selected) {
    return <SourceDetail source={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <View style={s.screen}>
      <Header title="취재원 정보" onBack={onBack} />
      <View style={s.banner}>
        <Text style={s.bannerText}>
          시안 화면입니다 — 아래는 예시 데이터이고, 등록·수정 기능은 다음 단계에서 연결됩니다.
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {SAMPLE_SOURCES.map((src) => (
          <Pressable
            key={src.id}
            style={({ pressed }) => [s.profileCard, pressed && { backgroundColor: C.surface2 }]}
            onPress={() => setSelected(src)}
          >
            <DefaultAvatar size={56} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{src.name}</Text>
              <Text style={s.org} numberOfLines={1}>{src.org} · {src.title}</Text>
              <Text style={s.phone}>{src.phone}</Text>
            </View>
            <Text style={s.chev}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 12,
  },
  back: { fontSize: 30, color: C.ink, lineHeight: 32, width: 24 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: C.ink },

  banner: {
    backgroundColor: C.goldSoft, borderRadius: 12, padding: 11, marginBottom: 12,
  },
  bannerText: { fontSize: 12, color: C.goldDeep, lineHeight: 18 },

  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 13, marginBottom: 10,
  },
  name: { fontSize: 15.5, fontWeight: "800", color: C.ink },
  org: { fontSize: 12.5, color: C.inkSoft, marginTop: 2 },
  phone: { fontSize: 12.5, color: C.skyDeep, marginTop: 3, fontVariant: ["tabular-nums"] },
  chev: { fontSize: 22, color: C.inkSoft },

  detailTop: { alignItems: "center", gap: 6, marginVertical: 14 },
  detailName: { fontSize: 21, fontWeight: "800", color: C.ink, marginTop: 6 },
  detailOrg: { fontSize: 13.5, color: C.inkSoft },

  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 14, marginBottom: 10,
  },
  cardLabel: { fontSize: 11.5, fontWeight: "800", color: C.inkSoft, marginBottom: 4 },
  cardValue: { fontSize: 14.5, color: C.ink, lineHeight: 21 },

  historyHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 14, marginBottom: 8,
  },
  section: { fontSize: 12, fontWeight: "800", color: C.inkSoft, letterSpacing: 0.5 },
  link: { fontSize: 13, fontWeight: "800", color: C.sageDeep },
  emptyHistory: {
    backgroundColor: C.surface2, borderRadius: 16, padding: 22,
    alignItems: "center",
  },
  emptyText: { fontSize: 13, color: C.inkSoft, textAlign: "center", lineHeight: 20 },
  futureNote: { fontSize: 11.5, color: C.inkSoft, marginTop: 12, lineHeight: 17 },
});
