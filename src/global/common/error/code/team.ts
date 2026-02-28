import type { ErrType } from '../errorCode';
/* team: 500000 */
export enum TeamErrEnum {
  notUser = 'notUser',
  teamOverSize = 'teamOverSize',
  unAuthTeam = 'unAuthTeam',
  teamMemberOverSize = 'teamMemberOverSize',
  aiPointsNotEnough = 'aiPointsNotEnough',
  datasetSizeNotEnough = 'datasetSizeNotEnough',
  datasetAmountNotEnough = 'datasetAmountNotEnough',
  appAmountNotEnough = 'appAmountNotEnough',
  pluginAmountNotEnough = 'pluginAmountNotEnough',
  appFolderAmountNotEnough = 'appFolderAmountNotEnough',
  websiteSyncNotEnough = 'websiteSyncNotEnough',
  reRankNotEnough = 'reRankNotEnough',
  ticketNotAvailable = 'ticketNotAvailable',
  groupNameEmpty = 'groupNameEmpty',
  groupNameDuplicate = 'groupNameDuplicate',
  groupNotExist = 'groupNotExist',
  orgMemberNotExist = 'orgMemberNotExist',
  orgMemberDuplicated = 'orgMemberDuplicated',
  orgNotExist = 'orgNotExist',
  orgParentNotExist = 'orgParentNotExist',
  cannotMoveToSubPath = 'cannotMoveToSubPath',
  cannotModifyRootOrg = 'cannotModifyRootOrg',
  cannotDeleteNonEmptyOrg = 'cannotDeleteNonEmptyOrg',
  cannotDeleteDefaultGroup = 'cannotDeleteDefaultGroup',
  userNotActive = 'userNotActive',
  invitationLinkInvalid = 'invitationLinkInvalid',
  youHaveBeenInTheTeam = 'youHaveBeenInTheTeam',
  tooManyInvitations = 'tooManyInvitations',
  unPermission = 'unPermission'
}

const teamErr = [
  { statusText: TeamErrEnum.notUser, message: '非团队用户' },
  { statusText: TeamErrEnum.unPermission, message: '无操作权限' },
  { statusText: TeamErrEnum.teamOverSize, message: '团队规模超限' },
  { statusText: TeamErrEnum.unAuthTeam, message: '未授权团队' },
  { statusText: TeamErrEnum.aiPointsNotEnough, message: 'AI 点数不足' },
  { statusText: TeamErrEnum.datasetSizeNotEnough, message: '知识库容量不足' },
  { statusText: TeamErrEnum.datasetAmountNotEnough, message: '知识库数量不足' },
  { statusText: TeamErrEnum.appAmountNotEnough, message: '应用数量不足' },
  { statusText: TeamErrEnum.pluginAmountNotEnough, message: '插件数量不足' },
  { statusText: TeamErrEnum.appFolderAmountNotEnough, message: '应用文件夹数量不足' },
  { statusText: TeamErrEnum.websiteSyncNotEnough, message: '站点同步额度不足' },
  { statusText: TeamErrEnum.reRankNotEnough, message: '重排序额度不足' },
  { statusText: TeamErrEnum.ticketNotAvailable, message: '工单不可用' },
  { statusText: TeamErrEnum.groupNameEmpty, message: '分组名称为空' },
  { statusText: TeamErrEnum.groupNotExist, message: '分组不存在' },
  { statusText: TeamErrEnum.cannotDeleteDefaultGroup, message: '无法删除默认分组' },
  { statusText: TeamErrEnum.groupNameDuplicate, message: '分组名称重复' },
  { statusText: TeamErrEnum.userNotActive, message: '用户未激活' },
  { statusText: TeamErrEnum.orgMemberNotExist, message: '组织成员不存在' },
  { statusText: TeamErrEnum.orgMemberDuplicated, message: '组织成员重复' },
  { statusText: TeamErrEnum.orgNotExist, message: '组织不存在' },
  { statusText: TeamErrEnum.orgParentNotExist, message: '上级组织不存在' },
  { statusText: TeamErrEnum.cannotMoveToSubPath, message: '无法移动到子路径' },
  { statusText: TeamErrEnum.cannotModifyRootOrg, message: '无法修改根组织' },
  { statusText: TeamErrEnum.cannotDeleteNonEmptyOrg, message: '无法删除非空组织' },
  { statusText: TeamErrEnum.invitationLinkInvalid, message: '邀请链接无效' },
  { statusText: TeamErrEnum.youHaveBeenInTheTeam, message: '您已在团队中' },
  { statusText: TeamErrEnum.tooManyInvitations, message: '邀请次数过多' }
];

export default teamErr.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 500000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${TeamErrEnum}`>);
