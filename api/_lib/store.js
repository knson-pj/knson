const { id, nowIso, normalizeAddress } = require('./utils');

// 로컬 개발 전용 기본 계정 (Supabase env 가 설정되지 않은 폴백 경로에서만 사용)
// 운영 환경에선 이 경로가 절대 실행되지 않지만(Supabase 가 정상 연결되어 있음),
// env 누락 등 비정상 상황에서도 하드코딩된 비밀번호로 누구나 로그인 가능한 상태를 막기 위해
// 반드시 환경변수로 명시 설정해야 seed 계정이 활성화되도록 제한한다.
//
// 필요한 환경변수:
//   KNSN_DEV_ADMIN_NAME / KNSN_DEV_ADMIN_PASSWORD   (둘 다 있어야 관리자 seed 활성화)
//   KNSN_DEV_AGENT_NAME / KNSN_DEV_AGENT_PASSWORD   (둘 다 있어야 담당자 seed 활성화)
function buildDevSeedStaff() {
  const staff = [];
  const adminName = String(process.env.KNSN_DEV_ADMIN_NAME || '').trim();
  const adminPassword = String(process.env.KNSN_DEV_ADMIN_PASSWORD || '').trim();
  const agentName = String(process.env.KNSN_DEV_AGENT_NAME || '').trim();
  const agentPassword = String(process.env.KNSN_DEV_AGENT_PASSWORD || '').trim();

  if (adminName && adminPassword) {
    staff.push({
      id: id('user'),
      name: adminName,
      password: adminPassword,
      role: 'admin',
      regions: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  if (agentName && agentPassword) {
    staff.push({
      id: id('user'),
      name: agentName,
      password: agentPassword,
      role: 'agent',
      regions: [{ level: 'gu', code: '서울특별시 강남구', label: '서울특별시 강남구' }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return staff;
}

function getGlobalStore() {
  if (!global.__KNSON_STORE__) {
    const seedStaff = buildDevSeedStaff();
    const seedAgent = seedStaff.find((u) => u.role === 'agent') || null;
    global.__KNSON_STORE__ = {
      sessions: {},
      properties: [],
      staff: seedStaff,
      realtorOffices: [],
      meta: {
        sampleCsvSchemas: {
          properties: [
            'source(auction|public)',
            'address',
            'price',
            'region',
            'district',
            'ownerName',
            'phone',
            'assigneeName',
            'status(active|hold|closed)',
            'note',
          ],
          realtorOffices: [
            'officeName',
            'address',
            'region',
            'district',
            'managerName',
            'officePhone',
            'mobilePhone',
            'note',
          ],
        },
      },
    };

    // seed minimal sample data
    global.__KNSON_STORE__.properties.push(
      {
        id: id('prop'),
        source: 'auction',
        address: '서울특별시 강남구 역삼동 123-45',
        normalizedAddress: normalizeAddress('서울특별시 강남구 역삼동 123-45'),
        price: 1250000000,
        region: '서울특별시',
        district: '강남구',
        dong: '역삼동',
        ownerName: '',
        phone: '',
        assigneeId: seedAgent ? seedAgent.id : null,
        assigneeName: seedAgent ? seedAgent.name : '',
        status: 'active',
        createdByType: 'system',
        createdByName: 'seed',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        note: '샘플 경매 물건',
      },
      {
        id: id('prop'),
        source: 'public',
        address: '서울특별시 송파구 문정동 88-1',
        normalizedAddress: normalizeAddress('서울특별시 송파구 문정동 88-1'),
        price: 980000000,
        region: '서울특별시',
        district: '송파구',
        dong: '문정동',
        ownerName: '',
        phone: '',
        assigneeId: null,
        assigneeName: '',
        status: 'active',
        createdByType: 'system',
        createdByName: 'seed',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        note: '샘플 공매 물건',
      }
    );
  }
  return global.__KNSON_STORE__;
}

function getStore() {
  return getGlobalStore();
}

module.exports = { getStore };
