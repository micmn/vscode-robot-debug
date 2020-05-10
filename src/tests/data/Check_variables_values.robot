*** Settings ***
Library    String
Library    Collections

*** Test Cases ***
A Simple Test Case
    Set Test Variable    ${var}    Value
    Test Keyword    ${var}    BBB

*** Keywords ***
Test Keyword
    [Arguments]    ${aaa}    ${bbb}
    @{list}=    Create List
    Append To List    ${list}    ${aaa}    ${bbb}
