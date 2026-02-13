export const copyPartyCode = async (partyCode, errorMessage) => {
    if (partyCode) {
        try {
            await navigator.clipboard.writeText(partyCode);
            console.log('Copied to clipboard: ', partyCode);
            return true;
        } catch (err) {
            errorMessage.value = "Clipboard access denied. Please paste manually.";
            console.error('Failed to copy: ', err);
        }
    }
};

export const pastePartyCode = async (errorMessage) => {
    try {
        const code = await navigator.clipboard.readText();
        console.log('Pasting from clipboard: ', code);
        return code;
    } catch (err) {
        console.error('Failed to paste: ', err);
        errorMessage.value = "Clipboard access denied. Please paste manually.";
    }
};