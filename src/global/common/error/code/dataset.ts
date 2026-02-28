import { type ErrType } from '../errorCode';

/* dataset: 501000 */
export enum DatasetErrEnum {
  unExist = 'unExistDataset',
  unExistCollection = 'unExistCollection',
  unAuthDataset = 'unAuthDataset',
  unCreateCollection = 'unCreateCollection',
  unAuthDatasetCollection = 'unAuthDatasetCollection',
  unAuthDatasetData = 'unAuthDatasetData',
  unAuthDatasetFile = 'unAuthDatasetFile',
  unLinkCollection = 'unLinkCollection',
  invalidVectorModelOrQAModel = 'invalidVectorModelOrQAModel',
  notSupportSync = 'notSupportSync',
  sameApiCollection = 'sameApiCollection',
  noApiServer = 'noApiServer',
  canNotEditAdminPermission = 'canNotEditAdminPermission'
}
const datasetErr = [
  { statusText: DatasetErrEnum.sameApiCollection, message: '相同 API 集合已存在' },
  { statusText: DatasetErrEnum.notSupportSync, message: '该集合不支持同步' },
  { statusText: DatasetErrEnum.unExist, message: '知识库不存在' },
  { statusText: DatasetErrEnum.unExistCollection, message: '集合不存在' },
  { statusText: DatasetErrEnum.unAuthDataset, message: '未授权知识库' },
  { statusText: DatasetErrEnum.unAuthDatasetCollection, message: '未授权知识库集合' },
  { statusText: DatasetErrEnum.unAuthDatasetData, message: '未授权知识库数据' },
  { statusText: DatasetErrEnum.unAuthDatasetFile, message: '未授权知识库文件' },
  { statusText: DatasetErrEnum.unCreateCollection, message: '无法创建集合' },
  { statusText: DatasetErrEnum.unLinkCollection, message: '无法关联集合' },
  { statusText: DatasetErrEnum.invalidVectorModelOrQAModel, message: '无效的向量模型或 QA 模型' },
  { statusText: DatasetErrEnum.canNotEditAdminPermission, message: '无法编辑管理员权限' }
];
export default datasetErr.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 501000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${DatasetErrEnum}`>);
