const { id, nowIso, normalizeAddress } = require('./utils');

function getGlobalStore() {
  if (!global.__KNSON_STORE__) {
    const adminId = id('user');
    const agentId = id('user');
    global.__KNSON_STORE__ = {
      sessions: {},
      properties: [],
      staff: [
        {
          id: adminId,
          name: '관리자',
          password: 'admin1234',
          role: 'admin',
          regions: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: agentId,
          name: '담당자1',
          password: 'agent1234',
          role: 'agent',
          regions: [{ level: 'gu', code: '서울특별시 강남구', label: '서울특별시 강남구' }],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ],
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
        assigneeId: agentId,
        assigneeName: '담당자1',
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
