package devicekey

func newVault(directory, account string) (vault, error) {
	copyBytes := func(value []byte) ([]byte, error) { return append([]byte(nil), value...), nil }
	return newFileVault(directory, account, copyBytes, copyBytes)
}
