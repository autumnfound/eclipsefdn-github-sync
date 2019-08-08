from github import Github

class SyncClient:

    @staticmethod
    def get_hosted_client(cfg):
        # if the onject passed is falsy, return
        if not cfg:
            return None
        # check that the host is set
        if not cfg["host"]:
            print("ERROR: no host provided for Github client")
            return None
        # check that the token is set
        if not cfg["token"]:
            print("ERROR: no token provided for Github client")
            return None

        # return a fresh client with the given host + token for access
        return Github(base_url = cfg["host"], login_or_token = cfg["token"])

    @staticmethod
    def get_github_client(cfg):
        # if the onject passed is falsy, return
        if not cfg:
            return None
        # check that the token is set
        if not cfg["token"]:
            print("ERROR: no token provided for Github client")
            return None

        # return a fresh client using github.com with the token for access
        return Github(cfg["token"])
