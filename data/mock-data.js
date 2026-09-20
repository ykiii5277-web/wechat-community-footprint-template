// 静态活动配置。页面通过 campId 在这里找到名称、场景和阶段。
// companions/photos/growthEntries/works 保留为开发示例；首次运行时数据层会创建可编辑的空列表。
module.exports = {
  profile: {
    id: 'me', name: '',
    bio: '',
    tags: [],
    // 头像与伙伴头像使用相同的“路径 + 裁切参数”结构。
    avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0,
    stats: { age: '', campCount: '' }
  },
  camps: [
    { id: 'rural', name: '学习成长', scene: 'rural', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    { id: 'summer', name: '社团活动', scene: 'school', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    { id: 'changsha', name: '社会实践', scene: 'changsha', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    { id: 'shanghai', name: '志愿服务', scene: 'shanghai', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    // “更多活动”里的预置分类继续复用同一套阶段、伙伴、相册、记录和作品模块。
    { id: 'winter', name: '主题活动', scene: 'winter', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    { id: 'spark', name: '兴趣计划', scene: 'spark', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] },
    // 自定义活动名存于内容的 activityName；分类 campId 始终为 other，保证榜单筛选口径一致。
    { id: 'other', name: '其他活动', scene: 'other', stages: [{ id: 'camper', name: '参与阶段' }, { id: 'volunteer', name: '服务阶段' }], subcamps: [] }
  ],
  companions: [
    { id: 'companion-1', name: '小雨', campId: 'rural' }, { id: 'companion-2', name: '阿成', campId: 'rural' }, { id: 'companion-3', name: '子涵', campId: 'rural' }, { id: 'companion-4', name: '乐乐', campId: 'summer' }, { id: 'companion-5', name: '晓峰', campId: 'changsha' }
  ],
  photos: [
    { id: 'photo-1', campId: 'rural', stageId: 'volunteer', subcampId: 'huangtu', category: '活动', date: '2024.07.12', title: '一起劳动', favorite: true },
    { id: 'photo-2', campId: 'rural', stageId: 'volunteer', subcampId: 'huangtu', category: '合影', date: '2024.07.16', title: '操场合影', favorite: false },
    { id: 'photo-3', campId: 'summer', category: '活动', date: '2024.08.16', title: '校园夏日', favorite: false },
    { id: 'photo-4', campId: 'changsha', stageId: 'camper', category: '活动', date: '2024.08.18', title: '湘江边的观察', favorite: true },
    { id: 'photo-5', campId: 'shanghai', category: '活动', date: '2024.09.05', title: '滨水公益行动', favorite: false }
  ],
  growthEntries: [
    { id: 'growth-1', title: '学会倾听，也被理解', body: '今天和小组伙伴一起完成社区调研。我听见了不同的声音，也更敢表达自己的想法。', tags: ['连接', '成长'], campId: 'summer', date: '2024.08.16', favorite: true },
    { id: 'growth-2', title: '行动让改变发生', body: '在公益活动里，每一份微小的投入都值得被认真看见。', tags: ['行动'], campId: 'shanghai', date: '2024.09.06', favorite: false }
  ],
  works: [
    { id: 'work-1', title: '我的学习成长手记', campId: 'rural', date: '2024.07.30', views: 128 },
    { id: 'work-2', title: '城市实践观察', campId: 'changsha', date: '2024.08.20', views: 96 },
    { id: 'work-3', title: '志愿服务成长记录', campId: 'shanghai', date: '2024.09.06', views: 112 }
  ]
};
