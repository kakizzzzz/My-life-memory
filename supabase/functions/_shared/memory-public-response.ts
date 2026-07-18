type UnknownRecord = Record<string, unknown>;

export type MemoryFinalAction =
  | 'ANSWER_FROM_EVIDENCE'
  | 'ASK_USER_EXACT'
  | 'STATE_NO_EVIDENCE_EXACT'
  | 'CALL_TOOL_AGAIN';

export type MemoryClarificationOption = {
  optionId: string;
  label: string;
};

export type MemoryReferenceClarification = {
  exactText: string;
  kind: 'yes-no' | 'choose-option' | 'request-facet';
  options: MemoryClarificationOption[];
  continuationToken: string | null;
  requestedFacets: Array<'time' | 'place' | 'title-word' | 'object-name' | 'activity'>;
};

export type PublicMemoryResearchResponse =
  | {
      schemaVersion: '2';
      status: 'supported';
      directive: {
        action: 'ANSWER_FROM_EVIDENCE';
        exactText: null;
        mayAddExplanation: true;
      };
      evidence: {
        passages: UnknownRecord[];
        records: UnknownRecord[];
        locations: UnknownRecord[];
        routes: UnknownRecord[];
        verifiedPlaceNames: string[];
        selectedImageNoteIds: string[];
      };
      confidenceKind: 'heuristic';
      confidenceBand: 'high' | 'medium' | 'low' | 'none';
      reasonCodes: string[];
      classification?: {
        label: 'travel' | 'daily' | 'mixed' | 'uncertain';
        confidenceKind: 'heuristic';
        confidenceBand: 'high' | 'medium' | 'low' | 'none';
      };
    }
  | {
      schemaVersion: '2';
      status: 'ambiguous';
      directive: {
        action: 'ASK_USER_EXACT';
        exactText: string;
        mayAddExplanation: false;
      };
      clarification: MemoryReferenceClarification;
      evidence: null;
    }
  | {
      schemaVersion: '2';
      status: 'not-found';
      directive: {
        action: 'STATE_NO_EVIDENCE_EXACT';
        exactText: string;
        mayAddExplanation: false;
      };
      clarification: {
        requestedFacets: MemoryReferenceClarification['requestedFacets'];
      } | null;
      evidence: null;
    }
  | {
      schemaVersion: '2';
      status: 'candidate-review';
      directive: {
        action: 'CALL_TOOL_AGAIN';
        exactText: string;
        mayAddExplanation: false;
      };
      continuationToken: string | null;
      evidence: null;
    };

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' ? value as UnknownRecord : {}
);

const asRecords = (value: unknown) => (
  Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as UnknownRecord[] : []
);

const asStrings = (value: unknown) => (
  Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : []
);

const queryLanguage = (query: string) => {
  if (/\p{Script=Hangul}/u.test(query)) return 'ko';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return 'ja';
  if (/\p{Script=Han}/u.test(query)) return 'zh';
  return 'en';
};

const noEvidenceText = (query: string) => {
  switch (queryLanguage(query)) {
    case 'zh': return '我暂时没有找到能完整支持这个问题的记录。可以补充大致时间、地点、标题词、对象名称，或你当时做了什么。';
    case 'ja': return 'この質問を十分に裏付ける記録を確認できませんでした。おおよその時期、場所、タイトルの言葉、対象の名前、または当時したことを追加してください。';
    case 'ko': return '이 질문을 충분히 뒷받침하는 기록을 확인하지 못했습니다. 대략적인 시간, 장소, 제목 단어, 대상 이름 또는 당시 한 일을 더 알려 주세요.';
    default: return 'I could not verify a saved memory that fully answers this question. Add an approximate time, place, title word, object name, or what you were doing.';
  }
};

const ambiguousText = (query: string) => {
  switch (queryLanguage(query)) {
    case 'zh': return '目前有多个可能的记忆位置，但证据不足以安全选择其中一个。请补充时间或其他可以区分它们的线索。';
    case 'ja': return '複数の記憶場所が考えられますが、安全に一つを選べるだけの証拠がありません。時期または区別できる手掛かりを追加してください。';
    case 'ko': return '가능한 기억 위치가 여러 곳이지만 하나를 안전하게 고를 근거가 부족합니다. 시기나 구분할 수 있는 단서를 더 알려 주세요.';
    default: return 'Several memory locations remain possible, but there is not enough evidence to choose one safely. Add a time range or another distinguishing detail.';
  }
};

const retryText = (query: string, status: unknown) => {
  const place = status === 'needs-place-resolution';
  switch (queryLanguage(query)) {
    case 'zh': return place
      ? '请先确认你指的是哪个公开地点，再重新查询；当前不能用其他地点代替。'
      : '请先按用户本地时区把相对时间换算成明确日期范围，再重新调用此工具。';
    case 'ja': return place
      ? '対象の公開地名を確認してから再検索してください。別の場所で代用しないでください。'
      : '相対時間をユーザーのローカルタイムゾーンで明確な日付範囲に変換してから、このツールを再度呼び出してください。';
    case 'ko': return place
      ? '어느 공개 장소를 뜻하는지 먼저 확인한 뒤 다시 검색하세요. 다른 장소로 대체하지 마세요.'
      : '상대 시간을 사용자 현지 시간대의 명확한 날짜 범위로 바꾼 뒤 이 도구를 다시 호출하세요.';
    default: return place
      ? 'Resolve the explicit public place before retrying. Do not substitute a different place.'
      : 'Convert the relative time into an exact user-local date range, then call this tool again.';
  }
};

const safeEvidencePassage = (value: unknown): UnknownRecord => {
  const passage = asRecord(value);
  const coordinates = asRecord(passage.coordinates);
  const hasCoordinates = Number.isFinite(Number(coordinates.lat)) && Number.isFinite(Number(coordinates.lng));
  return {
    noteId: String(passage.noteId || ''),
    starId: String(passage.starId || ''),
    role: String(passage.role || 'corroboration'),
    source: String(passage.source || 'body'),
    evidenceSource: passage.reviewSource === 'user-confirmed-reference'
      ? 'user-confirmed-reference'
      : 'stored-explicit',
    excerpt: String(passage.text || '').slice(0, 240),
    relation: String(passage.relation || ''),
    createdAt: Number.isFinite(Number(passage.createdAt)) ? Number(passage.createdAt) : null,
    ...(hasCoordinates ? {
      coordinates: { lat: Number(coordinates.lat), lng: Number(coordinates.lng) },
    } : {}),
  };
};

const confidenceBand = (value: unknown): 'high' | 'medium' | 'low' | 'none' => (
  value === 'high' || value === 'medium' || value === 'low' ? value : 'none'
);

const reasonCodes = (research: UnknownRecord) => {
  const queryPlan = asRecord(research.queryPlan);
  const personalContext = asRecord(research.personalContext);
  return [
    'authenticated-user-scope',
    ...(asRecords(research.evidencePassages).length ? ['verified-evidence-passages'] : []),
    ...(asStrings(queryPlan.anchorRelations).length ? ['personal-anchor-resolved'] : []),
    ...(asStrings(queryPlan.eventRelations).length ? ['event-target-linked'] : []),
    ...(queryPlan.routeIntent === true ? ['explicit-route-intent'] : []),
    ...(personalContext.matchSource === 'title' ? ['title-evidence'] : []),
  ];
};

export const projectPublicMemoryResearchResponse = ({
  research,
  records = [],
  locations = [],
  routes = [],
  referenceClarification = null,
}: {
  research: UnknownRecord;
  records?: UnknownRecord[];
  locations?: UnknownRecord[];
  routes?: UnknownRecord[];
  referenceClarification?: MemoryReferenceClarification | null;
}): PublicMemoryResearchResponse => {
  const boundary = asRecord(research.answerBoundary);
  const queryPlan = asRecord(research.queryPlan);
  const query = String(research.query || queryPlan.originalQuery || '');

  if (boundary.status === 'supported') {
    const classification = asRecord(research.classification);
    const includeClassification = queryPlan.answerIntent === 'classify';
    const passages = asRecords(research.evidencePassages).map(safeEvidencePassage);
    const evidenceNoteIds = new Set(passages.map(passage => String(passage.noteId || '')).filter(Boolean));
    const safeRecords = records.filter(record => evidenceNoteIds.has(String(record.id || '')));
    const evidenceStarIds = new Set([
      ...passages.map(passage => String(passage.starId || '')),
      ...safeRecords.map(record => String(record.starId || '')),
    ].filter(Boolean));
    const safeLocations = locations.filter(location => evidenceStarIds.has(String(location.id || '')));
    return {
      schemaVersion: '2',
      status: 'supported',
      directive: {
        action: 'ANSWER_FROM_EVIDENCE',
        exactText: null,
        mayAddExplanation: true,
      },
      evidence: {
        passages,
        records: safeRecords,
        locations: safeLocations,
        routes: queryPlan.routeIntent === true ? routes : [],
        verifiedPlaceNames: asStrings(boundary.verifiedPlaceNames),
        selectedImageNoteIds: asStrings(research.selectedImageNoteIds)
          .filter(noteId => evidenceNoteIds.has(noteId)),
      },
      confidenceKind: 'heuristic',
      confidenceBand: confidenceBand(research.confidenceBand),
      reasonCodes: reasonCodes(research),
      ...(includeClassification ? {
        classification: {
          label: ['travel', 'daily', 'mixed'].includes(String(classification.label))
            ? classification.label as 'travel' | 'daily' | 'mixed'
            : 'uncertain',
          confidenceKind: 'heuristic' as const,
          confidenceBand: confidenceBand(classification.confidenceBand),
        },
      } : {}),
    };
  }

  if (referenceClarification) return {
    schemaVersion: '2',
    status: 'ambiguous',
    directive: {
      action: 'ASK_USER_EXACT',
      exactText: referenceClarification.exactText,
      mayAddExplanation: false,
    },
    clarification: referenceClarification,
    evidence: null,
  };

  if (boundary.status === 'needs-time-range' || boundary.status === 'needs-place-resolution') {
    const exactText = retryText(query, boundary.status);
    return {
      schemaVersion: '2',
      status: 'candidate-review',
      directive: {
        action: 'CALL_TOOL_AGAIN',
        exactText,
        mayAddExplanation: false,
      },
      continuationToken: null,
      evidence: null,
    };
  }

  if (boundary.status === 'ambiguous') {
    const exactText = String(boundary.suggestedReply || '').trim() || ambiguousText(query);
    return {
      schemaVersion: '2',
      status: 'ambiguous',
      directive: {
        action: 'ASK_USER_EXACT',
        exactText,
        mayAddExplanation: false,
      },
      clarification: {
        exactText,
        kind: 'request-facet',
        options: [],
        continuationToken: null,
        requestedFacets: ['time'],
      },
      evidence: null,
    };
  }

  const exactText = noEvidenceText(query);
  return {
    schemaVersion: '2',
    status: 'not-found',
    directive: {
      action: 'STATE_NO_EVIDENCE_EXACT',
      exactText,
      mayAddExplanation: false,
    },
    clarification: {
      requestedFacets: ['time', 'place', 'title-word', 'object-name', 'activity'],
    },
    evidence: null,
  };
};

export const memoryResearchTextContent = (value: unknown) => {
  const response = asRecord(value);
  const directive = asRecord(response.directive);
  if (response.status !== 'supported') return String(directive.exactText || '');
  return JSON.stringify(value, null, 2);
};

// Compatibility export for older internal imports. It now performs strict
// allowlist projection rather than mutating and spreading the internal object.
export const applyMemoryResearchDisclosureBoundary = <T extends UnknownRecord>(research: T) => (
  projectPublicMemoryResearchResponse({ research })
);
