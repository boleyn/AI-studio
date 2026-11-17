package devicekey

import (
	"errors"
	"github.com/keybase/go-keychain"
)

type systemVault struct{ account string }

const keychainService = "tech.asiainfo.agenticops.local-device"

func newVault(_ string, account string) (vault, error) { return systemVault{account: account}, nil }
func (v systemVault) load() ([]byte, error) {
	query := keychain.NewItem()
	query.SetSecClass(keychain.SecClassGenericPassword)
	query.SetService(keychainService)
	query.SetAccount(v.account)
	query.SetMatchLimit(keychain.MatchLimitOne)
	query.SetReturnData(true)
	results, err := keychain.QueryItem(query)
	if errors.Is(err, keychain.ErrorItemNotFound) || (err == nil && len(results) == 0) {
		return nil, errMissing
	}
	if err != nil {
		return nil, errors.New("device_keychain_unavailable")
	}
	if len(results) != 1 {
		return nil, errors.New("invalid_stored_device_key")
	}
	return results[0].Data, nil
}
func (v systemVault) create(seed []byte) error {
	item := keychain.NewItem()
	item.SetSecClass(keychain.SecClassGenericPassword)
	item.SetService(keychainService)
	item.SetAccount(v.account)
	item.SetLabel("本机连接器 · 设备身份密钥（用于连接平台）")
	item.SetData(seed)
	item.SetSynchronizable(keychain.SynchronizableNo)
	item.SetAccessible(keychain.AccessibleWhenUnlockedThisDeviceOnly)
	err := keychain.AddItem(item)
	if err == nil || errors.Is(err, keychain.ErrorDuplicateItem) {
		return nil
	}
	return errors.New("device_keychain_unavailable")
}
